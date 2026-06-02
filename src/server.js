const express = require("express");
const db = require("./db");
const redisClient = require("./redis");
const { port } = require("./config");
const usersRouter = require("./routes/users");
const productsRouter = require("./routes/products");
const flashSaleProductsRouter = require("./routes/flashSaleProducts");
const ordersRouter = require("./routes/orders");

const app = express();

app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    await redisClient.ping();

    return res.status(200).json({ status: "ok" });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
});

app.use("/users", usersRouter);
app.use("/products", productsRouter);
app.use("/flash-sale-products", flashSaleProductsRouter);
app.use("/orders", ordersRouter);

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "internal server error" });
});

async function start() {
  try {
    await redisClient.connect();
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
