const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const staticTokenAuth = require("../middleware/staticTokenAuth");
const { generateTokenPair, verifyToken } = require("../utils/jwt");

const router = express.Router();

router.post("/", staticTokenAuth, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "username and password are required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (username, password)
       VALUES ($1, $2)
       RETURNING id, username, created_at, updated_at`,
      [username, hashedPassword]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "username already exists" });
    }

    console.error("Failed to create user:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "username and password are required" });
  }

  try {
    const result = await db.query(
      `SELECT id, username, password
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "invalid credentials" });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "invalid credentials" });
    }

    const tokens = generateTokenPair(user.id);
    return res.status(200).json({
      message: "login successful",
      userId: user.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch (error) {
    console.error("Failed to login:", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: "refreshToken is required" });
  }

  try {
    const payload = verifyToken(refreshToken);

    if (payload.type !== "refresh") {
      return res.status(401).json({ message: "invalid token type" });
    }

    const tokens = generateTokenPair(payload.userId);

    return res.status(200).json({
      message: "token refreshed",
      userId: payload.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch (error) {
    return res.status(401).json({ message: "invalid or expired refresh token" });
  }
});

module.exports = router;
