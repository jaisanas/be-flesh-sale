const express = require("express");
const db = require("../db");
const staticTokenAuth = require("../middleware/staticTokenAuth");
const { setProductStock } = require("../services/stockCache");

const router = express.Router();

router.get("/", staticTokenAuth, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, stock, price, created_at, updated_at
       FROM products
       ORDER BY id ASC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Failed to get products:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.post("/", staticTokenAuth, async (req, res) => {
  const { name, stock } = req.body;

  if (!name || typeof stock !== "number") {
    return res.status(400).json({ message: "name and numeric stock are required" });
  }

  try {
    const result = await db.query(
      `INSERT INTO products (name, stock)
       VALUES ($1, $2)
       RETURNING id, name, stock, price, created_at, updated_at`,
      [name, stock]
    );

    const product = result.rows[0];
    await setProductStock(product.id, product.stock);

    return res.status(201).json(product);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "product name already exists" });
    }

    console.error("Failed to create product:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

module.exports = router;
