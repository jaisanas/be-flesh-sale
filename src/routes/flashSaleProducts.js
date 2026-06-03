const express = require("express");
const db = require("../db");
const staticTokenAuth = require("../middleware/staticTokenAuth");
const {
  setFlashSaleStock,
  getFlashSaleStock,
  setProductStock,
} = require("../services/stockCache");

const router = express.Router();

function isActiveFlashSale(row) {
  const now = new Date();
  return new Date(row.start_date) <= now && now <= new Date(row.end_date);
}

function isUpcomingFlashSale(row) {
  return new Date(row.start_date) > new Date();
}

function resolveListFilter(req) {
  const { status, active, upcoming } = req.query;

  if (status === "upcoming" || upcoming === "true") {
    return "upcoming";
  }
  if (status === "active" || active === "true") {
    return "active";
  }
  if (status === "ended") {
    return "ended";
  }

  return "all";
}

async function attachCachedStock(rows) {
  return Promise.all(
    rows.map(async (row) => {
      const cachedStock = await getFlashSaleStock(row.id);
      return {
        ...row,
        cached_stock: cachedStock ?? row.stock,
        is_active: isActiveFlashSale(row),
        is_upcoming: isUpcomingFlashSale(row),
      };
    })
  );
}

router.get("/", async (req, res) => {
  const filter = resolveListFilter(req);

  const baseSelect = `
    SELECT fsp.id, fsp.product_id, p.name AS product_name,
           fsp.stock, fsp.price, fsp.start_date, fsp.end_date,
           fsp.created_at, fsp.updated_at
    FROM flash_sale_products fsp
    JOIN products p ON p.id = fsp.product_id
  `;

  const queries = {
    active: `${baseSelect}
      WHERE fsp.start_date <= NOW() AND fsp.end_date >= NOW()
      ORDER BY fsp.start_date ASC`,
    upcoming: `${baseSelect}
      WHERE fsp.start_date > NOW()
      ORDER BY fsp.start_date ASC`,
    ended: `${baseSelect}
      WHERE fsp.end_date < NOW()
      ORDER BY fsp.end_date DESC`,
    all: `${baseSelect}
      ORDER BY fsp.start_date ASC`,
  };

  try {
    const result = await db.query(queries[filter]);

    const rows = await attachCachedStock(result.rows);
    return res.status(200).json(rows);
  } catch (error) {
    console.error("Failed to list flash sale products:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT fsp.id, fsp.product_id, p.name AS product_name,
              fsp.stock, fsp.price, fsp.start_date, fsp.end_date,
              fsp.created_at, fsp.updated_at
       FROM flash_sale_products fsp
       JOIN products p ON p.id = fsp.product_id
       WHERE fsp.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "flash sale product not found" });
    }

    const row = result.rows[0];
    const cachedStock = await getFlashSaleStock(row.id);

    return res.status(200).json({
      ...row,
      cached_stock: cachedStock ?? row.stock,
      is_active: isActiveFlashSale(row),
      is_upcoming: isUpcomingFlashSale(row),
    });
  } catch (error) {
    console.error("Failed to get flash sale product:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.post("/", staticTokenAuth, async (req, res) => {
  const { product_id, stock, price, start_date, end_date } = req.body;

  if (
    !product_id ||
    typeof stock !== "number" ||
    price === undefined ||
    !start_date ||
    !end_date
  ) {
    return res.status(400).json({
      message: "product_id, stock, price, start_date, and end_date are required",
    });
  }

  if (new Date(end_date) <= new Date(start_date)) {
    return res.status(400).json({ message: "end_date must be after start_date" });
  }

  if (stock < 0) {
    return res.status(400).json({ message: "stock must be non-negative" });
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      `SELECT id, stock FROM products WHERE id = $1 FOR UPDATE`,
      [product_id]
    );

    if (productResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "product not found" });
    }

    const product = productResult.rows[0];

    if (product.stock < stock) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "insufficient product stock" });
    }

    const updatedProduct = await client.query(
      `UPDATE products
       SET stock = stock - $1
       WHERE id = $2
       RETURNING stock`,
      [stock, product_id]
    );

    const result = await client.query(
      `INSERT INTO flash_sale_products (product_id, stock, price, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, product_id, stock, price, start_date, end_date, created_at, updated_at`,
      [product_id, stock, price, start_date, end_date]
    );

    await client.query("COMMIT");

    const flashSale = result.rows[0];
    await setFlashSaleStock(flashSale.id, flashSale.stock);
    await setProductStock(product_id, updatedProduct.rows[0].stock);

    return res.status(201).json(flashSale);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to create flash sale product:", error);
    return res.status(500).json({ message: "internal server error" });
  } finally {
    client.release();
  }
});

router.patch("/:id", staticTokenAuth, async (req, res) => {
  const { id } = req.params;
  const { stock, price, start_date, end_date } = req.body;

  if (stock === undefined && price === undefined && !start_date && !end_date) {
    return res.status(400).json({ message: "at least one field is required to update" });
  }

  try {
    const existing = await db.query(
      `SELECT id, stock, price, start_date, end_date
       FROM flash_sale_products
       WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "flash sale product not found" });
    }

    const current = existing.rows[0];
    const nextStartDate = start_date ?? current.start_date;
    const nextEndDate = end_date ?? current.end_date;

    if (new Date(nextEndDate) <= new Date(nextStartDate)) {
      return res.status(400).json({ message: "end_date must be after start_date" });
    }

    const result = await db.query(
      `UPDATE flash_sale_products
       SET stock = COALESCE($2, stock),
           price = COALESCE($3, price),
           start_date = COALESCE($4, start_date),
           end_date = COALESCE($5, end_date)
       WHERE id = $1
       RETURNING id, product_id, stock, price, start_date, end_date, created_at, updated_at`,
      [id, stock, price, start_date, end_date]
    );

    const updated = result.rows[0];

    if (stock !== undefined) {
      await setFlashSaleStock(updated.id, updated.stock);
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error("Failed to update flash sale product:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

module.exports = router;
