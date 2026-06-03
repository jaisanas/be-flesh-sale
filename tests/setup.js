const fs = require("fs");
const path = require("path");

let db;
let redisClient;

beforeAll(async () => {
  db = require("../src/db");
  redisClient = require("../src/redis");

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  const initSql = fs.readFileSync(path.join(__dirname, "../db/init.sql"), "utf8");
  await db.query(initSql);
});

beforeEach(async () => {
  db = require("../src/db");
  redisClient = require("../src/redis");

  await db.query(
    "TRUNCATE orders, flash_sale_products, products, users RESTART IDENTITY CASCADE"
  );
  await redisClient.flushDb();
});

afterAll(async () => {
  db = require("../src/db");
  redisClient = require("../src/redis");

  if (redisClient.isOpen) {
    await redisClient.quit();
  }
  await db.pool.end();
});
