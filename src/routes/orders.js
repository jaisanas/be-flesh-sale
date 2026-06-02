const express = require("express");
const db = require("../db");
const jwtAuth = require("../middleware/jwtAuth");
const {
  reserveProductStock,
  reserveFlashSaleStock,
  releaseProductStock,
  releaseFlashSaleStock,
  setProductStock,
  setFlashSaleStock,
} = require("../services/stockCache");

const router = express.Router();

function isActiveFlashSale(row) {
  const now = new Date();
  return new Date(row.start_date) <= now && now <= new Date(row.end_date);
}

router.post("/", jwtAuth, async (req, res) => {
  const { productId, flashSaleProductId } = req.body;

  if (!productId && !flashSaleProductId) {
    return res.status(400).json({
      message: "productId or flashSaleProductId is required",
    });
  }

  if (productId && flashSaleProductId) {
    return res.status(400).json({
      message: "provide either productId or flashSaleProductId, not both",
    });
  }

  let reservedInRedis = false;
  let reserveType = null;
  let reserveId = null;

  try {
    if (flashSaleProductId) {
      reserveType = "flash_sale";
      reserveId = flashSaleProductId;

      const flashSaleResult = await db.query(
        `SELECT id, product_id, stock, start_date, end_date
         FROM flash_sale_products
         WHERE id = $1`,
        [flashSaleProductId]
      );

      if (flashSaleResult.rows.length === 0) {
        return res.status(404).json({ message: "flash sale product not found" });
      }

      const flashSale = flashSaleResult.rows[0];

      if (!isActiveFlashSale(flashSale)) {
        return res.status(400).json({ message: "flash sale is not active" });
      }

      const redisResult = await reserveFlashSaleStock(flashSaleProductId);

      if (redisResult === -2) {
        await setFlashSaleStock(flashSaleProductId, flashSale.stock);
        const retryResult = await reserveFlashSaleStock(flashSaleProductId);
        if (retryResult < 0) {
          return res.status(409).json({ message: "out of stock" });
        }
      } else if (redisResult < 0) {
        return res.status(409).json({ message: "out of stock" });
      }

      reservedInRedis = true;

      const client = await db.pool.connect();

      try {
        await client.query("BEGIN");

        const locked = await client.query(
          `SELECT id, product_id, stock
           FROM flash_sale_products
           WHERE id = $1
           FOR UPDATE`,
          [flashSaleProductId]
        );

        if (locked.rows[0].stock <= 0) {
          await client.query("ROLLBACK");
          await releaseFlashSaleStock(flashSaleProductId);
          return res.status(409).json({ message: "out of stock" });
        }

        await client.query(
          `UPDATE flash_sale_products
           SET stock = stock - 1
           WHERE id = $1`,
          [flashSaleProductId]
        );

        const orderResult = await client.query(
          `INSERT INTO orders (user_id, product_id, flash_sale_product_id, status)
           VALUES ($1, $2, $3, 'created')
           RETURNING id, user_id, product_id, flash_sale_product_id, status, created_at, updated_at`,
          [req.userId, locked.rows[0].product_id, flashSaleProductId]
        );

        await client.query("COMMIT");

        const updatedStock = locked.rows[0].stock - 1;
        await setFlashSaleStock(flashSaleProductId, updatedStock);

        return res.status(201).json(orderResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    reserveType = "product";
    reserveId = productId;

    const productResult = await db.query(
      `SELECT id, stock FROM products WHERE id = $1`,
      [productId]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ message: "product not found" });
    }

    const product = productResult.rows[0];
    const redisResult = await reserveProductStock(productId);

    if (redisResult === -2) {
      await setProductStock(productId, product.stock);
      const retryResult = await reserveProductStock(productId);
      if (retryResult < 0) {
        return res.status(409).json({ message: "out of stock" });
      }
    } else if (redisResult < 0) {
      return res.status(409).json({ message: "out of stock" });
    }

    reservedInRedis = true;

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      const locked = await client.query(
        `SELECT id, stock
         FROM products
         WHERE id = $1
         FOR UPDATE`,
        [productId]
      );

      if (locked.rows[0].stock <= 0) {
        await client.query("ROLLBACK");
        await releaseProductStock(productId);
        return res.status(409).json({ message: "out of stock" });
      }

      await client.query(
        `UPDATE products SET stock = stock - 1 WHERE id = $1`,
        [productId]
      );

      const orderResult = await client.query(
        `INSERT INTO orders (user_id, product_id, flash_sale_product_id, status)
         VALUES ($1, $2, NULL, 'created')
         RETURNING id, user_id, product_id, flash_sale_product_id, status, created_at, updated_at`,
        [req.userId, productId]
      );

      await client.query("COMMIT");

      const updatedStock = locked.rows[0].stock - 1;
      await setProductStock(productId, updatedStock);

      return res.status(201).json(orderResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (reservedInRedis) {
      if (reserveType === "flash_sale") {
        await releaseFlashSaleStock(reserveId);
      } else if (reserveType === "product") {
        await releaseProductStock(reserveId);
      }
    }

    console.error("Failed to create order:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.get("/", jwtAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT o.id, o.user_id, o.product_id, o.flash_sale_product_id,
              p.name AS product_name, o.status, o.created_at, o.updated_at
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.user_id = $1
       ORDER BY o.id DESC`,
      [req.userId]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Failed to list orders:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.get("/:id", jwtAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT o.id, o.user_id, o.product_id, o.flash_sale_product_id,
              p.name AS product_name, o.status, o.created_at, o.updated_at
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "order not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Failed to get order:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.patch("/:id", jwtAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["paid", "cancelled"].includes(status)) {
    return res.status(400).json({ message: "status must be paid or cancelled" });
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT o.id, o.user_id, o.product_id, o.flash_sale_product_id, o.status
       FROM orders o
       WHERE o.id = $1 AND o.user_id = $2
       FOR UPDATE`,
      [id, req.userId]
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "order not found" });
    }

    const order = orderResult.rows[0];

    if (order.status !== "created") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "order cannot be updated" });
    }

    if (status === "cancelled") {
      if (order.flash_sale_product_id) {
        await client.query(
          `UPDATE flash_sale_products SET stock = stock + 1 WHERE id = $1`,
          [order.flash_sale_product_id]
        );

        const flashSaleStock = await client.query(
          `SELECT stock FROM flash_sale_products WHERE id = $1`,
          [order.flash_sale_product_id]
        );

        await releaseFlashSaleStock(order.flash_sale_product_id);
        await setFlashSaleStock(
          order.flash_sale_product_id,
          flashSaleStock.rows[0].stock
        );
      } else {
        await client.query(
          `UPDATE products SET stock = stock + 1 WHERE id = $1`,
          [order.product_id]
        );

        const productStock = await client.query(
          `SELECT stock FROM products WHERE id = $1`,
          [order.product_id]
        );

        await releaseProductStock(order.product_id);
        await setProductStock(order.product_id, productStock.rows[0].stock);
      }
    }

    const updated = await client.query(
      `UPDATE orders
       SET status = $2
       WHERE id = $1
       RETURNING id, user_id, product_id, flash_sale_product_id, status, created_at, updated_at`,
      [id, status]
    );

    await client.query("COMMIT");
    return res.status(200).json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to update order:", error);
    return res.status(500).json({ message: "internal server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
