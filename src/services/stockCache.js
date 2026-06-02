const redisClient = require("../redis");

const PRODUCT_STOCK_PREFIX = "product:stock:";
const FLASH_SALE_STOCK_PREFIX = "flash_sale:stock:";

const RESERVE_STOCK_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  return -2
end
current = tonumber(current)
if current <= 0 then
  return -1
end
redis.call('DECR', KEYS[1])
return current - 1
`;

async function setProductStock(productId, stock) {
  await redisClient.set(`${PRODUCT_STOCK_PREFIX}${productId}`, String(stock));
}

async function setFlashSaleStock(flashSaleProductId, stock) {
  await redisClient.set(`${FLASH_SALE_STOCK_PREFIX}${flashSaleProductId}`, String(stock));
}

async function getProductStock(productId) {
  const value = await redisClient.get(`${PRODUCT_STOCK_PREFIX}${productId}`);
  return value === null ? null : Number(value);
}

async function getFlashSaleStock(flashSaleProductId) {
  const value = await redisClient.get(`${FLASH_SALE_STOCK_PREFIX}${flashSaleProductId}`);
  return value === null ? null : Number(value);
}

async function reserveProductStock(productId) {
  return redisClient.eval(RESERVE_STOCK_SCRIPT, {
    keys: [`${PRODUCT_STOCK_PREFIX}${productId}`],
  });
}

async function reserveFlashSaleStock(flashSaleProductId) {
  return redisClient.eval(RESERVE_STOCK_SCRIPT, {
    keys: [`${FLASH_SALE_STOCK_PREFIX}${flashSaleProductId}`],
  });
}

async function releaseProductStock(productId, quantity = 1) {
  await redisClient.incrBy(`${PRODUCT_STOCK_PREFIX}${productId}`, quantity);
}

async function releaseFlashSaleStock(flashSaleProductId, quantity = 1) {
  await redisClient.incrBy(`${FLASH_SALE_STOCK_PREFIX}${flashSaleProductId}`, quantity);
}

module.exports = {
  setProductStock,
  setFlashSaleStock,
  getProductStock,
  getFlashSaleStock,
  reserveProductStock,
  reserveFlashSaleStock,
  releaseProductStock,
  releaseFlashSaleStock,
};
