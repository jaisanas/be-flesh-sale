const dotenv = require("dotenv");

if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}

module.exports = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  staticApiToken: process.env.STATIC_API_TOKEN,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
};
