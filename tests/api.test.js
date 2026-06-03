const request = require("supertest");
const app = require("../src/app");

const STATIC_TOKEN = process.env.STATIC_API_TOKEN;
const staticAuth = () => ({ Authorization: `Bearer ${STATIC_TOKEN}` });

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

async function createUser(username = "testuser", password = "password123") {
  const res = await request(app)
    .post("/users")
    .set(staticAuth())
    .send({ username, password });

  return res;
}

async function loginUser(username = "testuser", password = "password123") {
  const res = await request(app).post("/users/login").send({ username, password });
  return res;
}

async function createProduct(name = "Laptop", stock = 100, price = 500) {
  const res = await request(app)
    .post("/products")
    .set(staticAuth())
    .send({ name, stock, price });

  return res;
}

describe("API endpoints", () => {
  describe("GET /health", () => {
    it("returns ok when postgres and redis are available", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("POST /users", () => {
    it("creates a user with static token", async () => {
      const res = await createUser();

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        username: "testuser",
      });
      expect(res.body.password).toBeUndefined();
    });

    it("returns 401 without static token", async () => {
      const res = await request(app)
        .post("/users")
        .send({ username: "john", password: "secret" });

      expect(res.status).toBe(401);
    });

    it("returns 400 when username or password is missing", async () => {
      const res = await request(app).post("/users").set(staticAuth()).send({ username: "john" });

      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate username", async () => {
      await createUser();
      const res = await createUser();

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("username already exists");
    });
  });

  describe("POST /users/login", () => {
    it("returns JWT tokens on valid credentials", async () => {
      await createUser();
      const res = await loginUser();

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("login successful");
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.userId).toBeDefined();
    });

    it("returns 401 for invalid credentials", async () => {
      await createUser();
      const res = await request(app)
        .post("/users/login")
        .send({ username: "testuser", password: "wrong" });

      expect(res.status).toBe(401);
    });

    it("returns 400 when fields are missing", async () => {
      const res = await request(app).post("/users/login").send({ username: "testuser" });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /users/refresh", () => {
    it("returns a new token pair from refresh token", async () => {
      await createUser();
      const loginRes = await loginUser();

      const res = await request(app)
        .post("/users/refresh")
        .send({ refreshToken: loginRes.body.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.message).toBe("token refreshed");
    });

    it("returns 401 for access token used as refresh token", async () => {
      await createUser();
      const loginRes = await loginUser();

      const res = await request(app)
        .post("/users/refresh")
        .send({ refreshToken: loginRes.body.accessToken });

      expect(res.status).toBe(401);
    });

    it("returns 400 when refreshToken is missing", async () => {
      const res = await request(app).post("/users/refresh").send({});

      expect(res.status).toBe(400);
    });
  });

  describe("GET /products and POST /products", () => {
    it("returns 401 without static token on GET", async () => {
      const res = await request(app).get("/products");

      expect(res.status).toBe(401);
    });

    it("creates and lists products with price", async () => {
      const createRes = await createProduct("Monitor", 10, 500);

      expect(createRes.status).toBe(201);
      expect(createRes.body.name).toBe("Monitor");
      expect(Number(createRes.body.price)).toBe(500);

      const listRes = await request(app).get("/products").set(staticAuth());

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].name).toBe("Monitor");
    });

    it("returns 400 when price is missing on create", async () => {
      const res = await request(app)
        .post("/products")
        .set(staticAuth())
        .send({ name: "Keyboard", stock: 5 });

      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate product name", async () => {
      await createProduct("Mouse", 5, 20);
      const res = await createProduct("Mouse", 3, 15);

      expect(res.status).toBe(409);
    });
  });

  describe("GET /flash-sale-products", () => {
    it("lists all flash sale products by default", async () => {
      const product = await createProduct("Phone", 50, 999);
      const productId = product.body.id;

      await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(productId),
          stock: 10,
          price: 799,
          start_date: daysFromNow(-1),
          end_date: daysFromNow(1),
        });

      await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(productId),
          stock: 5,
          price: 749,
          start_date: daysFromNow(2),
          end_date: daysFromNow(5),
        });

      const allRes = await request(app).get("/flash-sale-products");
      const activeRes = await request(app).get("/flash-sale-products?active=true");
      const upcomingRes = await request(app).get("/flash-sale-products?upcoming=true");

      expect(allRes.status).toBe(200);
      expect(allRes.body).toHaveLength(2);
      expect(activeRes.body).toHaveLength(1);
      expect(upcomingRes.body).toHaveLength(1);
      expect(upcomingRes.body[0].is_upcoming).toBe(true);
    });

    it("returns 404 for unknown flash sale id", async () => {
      const res = await request(app).get("/flash-sale-products/99999");

      expect(res.status).toBe(404);
    });

    it("returns flash sale detail with cached_stock", async () => {
      const product = await createProduct("Tablet", 20, 300);
      const createRes = await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(product.body.id),
          stock: 8,
          price: 250,
          start_date: daysFromNow(-1),
          end_date: daysFromNow(2),
        });

      const res = await request(app).get(`/flash-sale-products/${createRes.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.cached_stock).toBe(8);
      expect(res.body.is_active).toBe(true);
    });
  });

  describe("POST /flash-sale-products", () => {
    it("decrements parent product stock when flash sale is created", async () => {
      const product = await createProduct("Headphones", 30, 100);

      const flashRes = await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(product.body.id),
          stock: 12,
          price: 80,
          start_date: daysFromNow(-1),
          end_date: daysFromNow(3),
        });

      const productRes = await request(app).get("/products").set(staticAuth());

      expect(flashRes.status).toBe(201);
      expect(flashRes.body.stock).toBe(12);
      expect(productRes.body[0].stock).toBe(18);
    });

    it("returns 409 when product stock is insufficient", async () => {
      const product = await createProduct("Cable", 5, 10);

      const res = await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(product.body.id),
          stock: 10,
          price: 5,
          start_date: daysFromNow(1),
          end_date: daysFromNow(3),
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("insufficient product stock");
    });

    it("returns 400 when end_date is before start_date", async () => {
      const product = await createProduct("Hub", 10, 40);

      const res = await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(product.body.id),
          stock: 2,
          price: 30,
          start_date: daysFromNow(3),
          end_date: daysFromNow(1),
        });

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /flash-sale-products/:id", () => {
    it("updates flash sale fields", async () => {
      const product = await createProduct("Camera", 15, 600);
      const createRes = await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(product.body.id),
          stock: 5,
          price: 500,
          start_date: daysFromNow(-1),
          end_date: daysFromNow(2),
        });

      const res = await request(app)
        .patch(`/flash-sale-products/${createRes.body.id}`)
        .set(staticAuth())
        .send({ price: 450 });

      expect(res.status).toBe(200);
      expect(Number(res.body.price)).toBe(450);
    });

    it("returns 404 for unknown id", async () => {
      const res = await request(app)
        .patch("/flash-sale-products/99999")
        .set(staticAuth())
        .send({ price: 1 });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /orders", () => {
    let accessToken;
    let productId;

    beforeEach(async () => {
      await createUser();
      const loginRes = await loginUser();
      accessToken = loginRes.body.accessToken;

      const productRes = await createProduct("Chair", 20, 150);
      productId = productRes.body.id;
    });

    it("creates order for regular product with JWT", async () => {
      const res = await request(app)
        .post("/orders")
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ productId: Number(productId) });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("created");
      expect(res.body.flash_sale_product_id).toBeNull();
    });

    it("returns 401 without JWT", async () => {
      const res = await request(app)
        .post("/orders")
        .send({ productId: Number(productId) });

      expect(res.status).toBe(401);
    });

    it("returns 400 when both productId and flashSaleProductId are sent", async () => {
      const res = await request(app)
        .post("/orders")
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ productId: Number(productId), flashSaleProductId: 1 });

      expect(res.status).toBe(400);
    });

    it("creates order for active flash sale product", async () => {
      const flashRes = await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(productId),
          stock: 4,
          price: 120,
          start_date: daysFromNow(-1),
          end_date: daysFromNow(2),
        });

      const res = await request(app)
        .post("/orders")
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ flashSaleProductId: Number(flashRes.body.id) });

      expect(res.status).toBe(201);
      expect(res.body.flash_sale_product_id).toBe(String(flashRes.body.id));
    });

    it("returns 400 when flash sale is not active", async () => {
      const flashRes = await request(app)
        .post("/flash-sale-products")
        .set(staticAuth())
        .send({
          product_id: Number(productId),
          stock: 2,
          price: 120,
          start_date: daysFromNow(2),
          end_date: daysFromNow(5),
        });

      const res = await request(app)
        .post("/orders")
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ flashSaleProductId: Number(flashRes.body.id) });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("flash sale is not active");
    });
  });

  describe("GET /orders and PATCH /orders/:id", () => {
    let accessToken;
    let orderId;

    beforeEach(async () => {
      await createUser();
      const loginRes = await loginUser();
      accessToken = loginRes.body.accessToken;

      const productRes = await createProduct("Desk", 10, 200);
      const orderRes = await request(app)
        .post("/orders")
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ productId: Number(productRes.body.id) });

      orderId = orderRes.body.id;
    });

    it("lists and gets orders for authenticated user", async () => {
      const listRes = await request(app)
        .get("/orders")
        .set({ Authorization: `Bearer ${accessToken}` });

      const detailRes = await request(app)
        .get(`/orders/${orderId}`)
        .set({ Authorization: `Bearer ${accessToken}` });

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(orderId);
    });

    it("marks order as paid", async () => {
      const res = await request(app)
        .patch(`/orders/${orderId}`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ status: "paid" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("paid");
    });

    it("cancels order and restores product stock", async () => {
      const productsBefore = await request(app).get("/products").set(staticAuth());
      const stockBefore = productsBefore.body[0].stock;

      const cancelRes = await request(app)
        .patch(`/orders/${orderId}`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ status: "cancelled" });

      const productsAfter = await request(app).get("/products").set(staticAuth());

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe("cancelled");
      expect(productsAfter.body[0].stock).toBe(stockBefore + 1);
    });

    it("returns 400 when updating non-created order", async () => {
      await request(app)
        .patch(`/orders/${orderId}`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ status: "paid" });

      const res = await request(app)
        .patch(`/orders/${orderId}`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ status: "cancelled" });

      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown order", async () => {
      const res = await request(app)
        .get("/orders/99999")
        .set({ Authorization: `Bearer ${accessToken}` });

      expect(res.status).toBe(404);
    });
  });
});
