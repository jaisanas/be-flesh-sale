const { createClient } = require("redis");
const { redisUrl } = require("./config");

if (!redisUrl) {
  throw new Error("REDIS_URL is required");
}

const redisClient = createClient({
  url: redisUrl,
});

redisClient.on("error", (error) => {
  console.error("Redis error:", error);
});

module.exports = redisClient;
