process.env.NODE_ENV = "test";
process.env.PORT = "3000";
process.env.STATIC_API_TOKEN = "test-static-token";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.JWT_EXPIRES_IN = "1d";
// Port 5433 avoids conflict when a local PostgreSQL instance already uses 5432.
process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5433/flash_sale_db";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
