# Flash Sale System

A highly scalable flash sale platform designed to handle massive traffic spikes, maintain inventory consistency, and prevent overselling during high-demand product launches.

## Overview

This project demonstrates the architecture and implementation of a production-grade flash sale (flesh sale) system capable of handling tens of thousands of concurrent purchase requests while ensuring strong inventory consistency.

### Key Objectives

- Handle extremely high request throughput
- Prevent overselling and double inventory updates
- Maintain data consistency under heavy concurrency
- Automatically expire reservations using TTL
- Support distributed transaction workflows
- Recover gracefully from partial failures

---

## Architecture

```text
Client
   |
   v
Express API
   |
   +------------------+
   |                  |
   v                  v
Redis            PostgreSQL
(TTL Cache)      (Source of Truth)
   |
   v
Saga Orchestrator
   |
   +-------> Payment Service
   |
   +-------> Order Service
   |
   +-------> Inventory Service
```

---

## Technology Stack

### Backend

- Node.js
- Express.js

### Database

- PostgreSQL
  - Source of truth for inventory and orders
  - Row-level locking
  - Transactions
  - Strong consistency guarantees

### Cache & Reservation

- Redis
  - Temporary stock reservation
  - TTL-based lock expiration
  - Request throttling
  - Distributed coordination

### Distributed Transactions

- Saga Pattern
  - Handles multi-service workflows
  - Supports compensation actions
  - Eliminates need for two-phase commit (2PC)

---

## Core Features

### Inventory Protection

Inventory updates are executed inside PostgreSQL transactions using row-level locks.

Example flow:

1. Begin transaction
2. Lock inventory row (`SELECT ... FOR UPDATE`)
3. Validate stock availability
4. Deduct inventory
5. Commit transaction

This prevents:

- Double updates
- Race conditions
- Overselling

---

### Redis Reservation Layer

Before reaching the database:

1. User requests product purchase
2. Redis reserves stock
3. Reservation receives TTL
4. User completes payment
5. Reservation converted into order

If payment is not completed before TTL expires:

- Reservation is automatically released
- Stock becomes available again

Benefits:

- Reduced database contention
- Faster user response times
- Automatic cleanup of abandoned carts

---

### Saga Workflow

The purchase flow is coordinated using Saga Pattern.

```text
Reserve Stock
      |
      v
Create Order
      |
      v
Process Payment
      |
      v
Confirm Order
```

#### Compensation Flow

If payment fails:

```text
Payment Failed
      |
      v
Cancel Order
      |
      v
Release Inventory
```

This ensures eventual consistency across services.

---

## High Throughput Design

### Horizontal Scaling

Multiple Express instances can be deployed behind a load balancer.

```text
           Load Balancer
          /      |      \
         /       |       \
      API1     API2     API3
```

### Database Optimization

- Indexed inventory lookups
- Connection pooling
- Read replicas for analytics
- Partitioned order tables

### Redis Optimization

- In-memory operations
- Atomic Lua scripts
- Key expiration (TTL)
- Rate limiting

---

## Consistency Strategy

### Why PostgreSQL?

Flash sale systems are extremely sensitive to inventory corruption.

Using PostgreSQL transactions provides:

- ACID guarantees
- Row-level locking
- Serializable operations
- Reliable recovery

The database remains the single source of truth for inventory.

### Why Redis?

Redis is used only for:

- Temporary reservations
- Request throttling
- TTL management

Redis is **not** considered the authoritative inventory source.

---

## Purchase Flow

```text
User Clicks Buy
        |
        v
Redis Reservation
        |
        v
PostgreSQL Inventory Check
        |
        v
Create Order
        |
        v
Payment Processing
        |
        +---- Success ----> Confirm Order
        |
        +---- Failure ----> Saga Compensation
```

---

## Scalability Goals

Target metrics:

| Metric             | Target   |
| ------------------ | -------- |
| Concurrent Users   | 100,000+ |
| Requests/sec       | 20,000+  |
| Inventory Accuracy | 100%     |
| Overselling        | 0        |
| API Availability   | 99.9%+   |

---

## Future Improvements

- Kafka for event streaming
- CQRS architecture
- Outbox pattern
- Multi-region deployment
- Distributed tracing
- Real-time inventory updates via WebSocket
- Kubernetes autoscaling

---

## Lessons Learned

Building a flash sale platform is not only about handling traffic spikes. The biggest challenge is preserving inventory correctness under extreme concurrency.

This architecture combines:

- Express.js for high-performance APIs
- PostgreSQL for strong consistency
- Redis for fast reservation management
- Saga Pattern for distributed transaction reliability

to deliver a resilient, scalable, and production-ready flash sale system.

---

## Quick Start (This Implementation)

### Testing

Integration tests cover all API endpoints using **Jest** and **Supertest**. They run against real PostgreSQL and Redis (not mocks).

#### Test dependencies

Installed as dev dependencies (included after `npm install`):

| Package     | Version | Purpose                                 |
| ----------- | ------- | --------------------------------------- |
| `jest`      | ^30.x   | Test runner                             |
| `supertest` | ^7.x    | HTTP assertions against the Express app |

Install manually if needed:

```bash
npm install --save-dev jest supertest
```

#### Prerequisites

- **Node.js** 20+
- **PostgreSQL** and **Redis** running locally (Docker Compose is recommended)

Tests connect to:

| Service    | URL (test default)                                          |
| ---------- | ----------------------------------------------------------- |
| PostgreSQL | `postgres://postgres:postgres@127.0.0.1:5433/flash_sale_db` |
| Redis      | `redis://127.0.0.1:6379`                                    |

Postgres uses port **5433** on the host (mapped in `docker-compose.yml`) so tests do not conflict with a local PostgreSQL instance that may already use port 5432.

#### Run tests

1. Start database and cache:

```bash
docker compose up -d postgres redis
```

2. Install dependencies (first time only):

```bash
npm install
```

3. Run the test suite:

```bash
npm test
```

Equivalent script: `jest --runInBand --forceExit` (serial execution, clean exit after shared DB/Redis connections).

#### Test layout

| File                | Role                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `tests/env.js`      | Sets `NODE_ENV=test` and test DB/Redis URLs (loaded before tests) |
| `tests/setup.js`    | Applies schema, connects Redis, truncates tables between tests    |
| `tests/api.test.js` | Integration tests for every endpoint (33 cases)                   |
| `jest.config.js`    | Jest configuration                                                |
| `src/app.js`        | Express app export used by Supertest (no HTTP server listen)      |

#### What is tested

- `GET /health`
- `POST /users`, `POST /users/login`, `POST /users/refresh`
- `GET /products`, `POST /products` (including `price`)
- `GET /flash-sale-products` (all, `?active=true`, `?upcoming=true`)
- `GET /flash-sale-products/:id`
- `POST /flash-sale-products`, `PATCH /flash-sale-products/:id`
- `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id`

Auth, validation, stock allocation, and Redis cache behavior are included where applicable.

#### Troubleshooting

- **`role "postgres" does not exist`** — Another PostgreSQL is bound to port 5432. Use Docker Postgres on **5433** (`docker compose up -d postgres`) and run `npm test` again.
- **Redis / Postgres connection refused** — Ensure `docker compose up -d postgres redis` is running.
- **Stale schema** — Recreate volumes if columns are missing: `docker compose down -v && docker compose up -d postgres redis`

### Run with Docker

```bash
docker compose up --build
```

The API will run at `http://localhost:3000`.

### Postman collection

A Postman collection is included at the project root for quick manual testing:

```
Flash Sale.postman_collection.json
```

#### Import

1. Open Postman.
2. Click **Import** (top left).
3. Select the file `Flash Sale.postman_collection.json` from this repository.
4. The **Flash Sale** collection appears in the sidebar.

#### Included requests

- `Create New User` — `POST /users`
- `Login` — `POST /users/login`
- `Refresh Token` — `POST /users/refresh`
- `Create Product` — `POST /products`
- `List Products` — `GET /products`
- `Create Flash Sale Product` — `POST /flash-sale-products`
- `List Flash Sale Products` — `GET /flash-sale-products` (with `?active=true` / `?upcoming=true` variants)
- `Get Flash Sale Product` — `GET /flash-sale-products/:id`
- `Update Flash Sale Product` — `PATCH /flash-sale-products/:id`
- `Create Order` — `POST /orders`
- `List Orders` — `GET /orders`
- `Get Order` — `GET /orders/:id`
- `Update Order Status` — `PATCH /orders/:id`

#### Auth tokens used in the collection

The requests target `http://localhost:3000` and use:

- Static token header: `Authorization: Bearer static-dev-token` (matches `STATIC_API_TOKEN` in `.env`)
- JWT bearer token from the **Login** response — copy `accessToken` into the `Authorization` header for `/orders` requests.

If you change `STATIC_API_TOKEN` or `JWT_SECRET` in your `.env`, update the headers in the collection accordingly.

### CORS (frontend clients)

The API allows browser requests from origins listed in `CORS_ORIGIN` (default: `http://localhost:5173` for Vite).

```env
CORS_ORIGIN=http://localhost:5173
```

Multiple origins (comma-separated):

```env
CORS_ORIGIN=http://localhost:5173,http://localhost:3001
```

Restart the API after changing this value.

### Auth

- Static token header for protected endpoints:
  - `Authorization: Bearer <STATIC_API_TOKEN>`
- JWT endpoints:
  - `POST /users/login` returns `accessToken` and `refreshToken`
  - `POST /users/refresh` accepts `refreshToken` and returns a new token pair

### Endpoints

- `POST /users` (static token required)
  - body: `{ "username": "john", "password": "123456" }`
- `POST /users/login`
  - body: `{ "username": "john", "password": "123456" }`
- `POST /users/refresh`
  - body: `{ "refreshToken": "<token>" }`
- `GET /products` (static token required)
- `POST /products` (static token required)
  - body: `{ "name": "Laptop", "stock": 10, "price": 500 }`
- `GET /flash-sale-products` (public, returns all by default)
  - `?upcoming=true` or `?status=upcoming` — sales not started yet (`start_date > now`)
  - `?active=true` or `?status=active` — sales in progress
  - `?status=ended` — sales past `end_date`
- `GET /flash-sale-products/:id` (public, includes `cached_stock` from Redis)
- `POST /flash-sale-products` (static token required)
  - body: `{ "product_id": 1, "stock": 100, "price": 9.99, "start_date": "...", "end_date": "..." }`
  - allocates flash sale stock from the linked product (`products.stock` is reduced by the same amount)
- `PATCH /flash-sale-products/:id` (static token required)
- `POST /orders` (JWT access token required)
  - body: `{ "productId": 1 }` or `{ "flashSaleProductId": 1 }`
- `GET /orders` (JWT access token required)
- `GET /orders/:id` (JWT access token required)
- `PATCH /orders/:id` (JWT access token required)
  - body: `{ "status": "paid" }` or `{ "status": "cancelled" }` (restores stock on cancel)

---

## Redis Stock Caching

This service uses Redis as a **fast, in-memory stock layer** for purchase requests. PostgreSQL remains the **source of truth** for inventory and orders. Redis reduces database contention during traffic spikes by rejecting out-of-stock requests early, before a transaction is opened.

Implementation lives in:

- `src/redis.js` — Redis client connection
- `src/services/stockCache.js` — key naming, read/write, atomic reserve/release
- `src/routes/orders.js` — order flow that coordinates Redis + PostgreSQL
- `src/routes/products.js` — seeds product stock into Redis on create
- `src/routes/flashSaleProducts.js` — seeds/updates flash sale stock and exposes `cached_stock`

### Configuration

| Variable    | Example                       | Purpose                             |
| ----------- | ----------------------------- | ----------------------------------- |
| `REDIS_URL` | `redis://redis:6379` (Docker) | Connection URL for the Redis client |

In Docker Compose, the `app` service connects to the `redis` service on the internal network. The `/health` endpoint runs `PING` against Redis to confirm connectivity.

### Key design

Two separate key namespaces are used so regular product stock and flash sale stock never collide:

| Key pattern                             | Example              | Value          | Used for                                            |
| --------------------------------------- | -------------------- | -------------- | --------------------------------------------------- |
| `product:stock:{productId}`             | `product:stock:1`    | integer string | Regular `POST /orders` with `productId`             |
| `flash_sale:stock:{flashSaleProductId}` | `flash_sale:stock:3` | integer string | Flash sale `POST /orders` with `flashSaleProductId` |

Keys store the **remaining available quantity** as a plain string (e.g. `"42"`). There is no TTL on these keys in the current implementation; they are updated explicitly when stock changes.

### Stock cache API (`src/services/stockCache.js`)

| Function                    | Redis operation               | Description                                      |
| --------------------------- | ----------------------------- | ------------------------------------------------ |
| `setProductStock(id, n)`    | `SET product:stock:{id} n`    | Write/replace cached stock for a product         |
| `setFlashSaleStock(id, n)`  | `SET flash_sale:stock:{id} n` | Write/replace cached stock for a flash sale item |
| `getProductStock(id)`       | `GET`                         | Read cached stock; returns `null` if key missing |
| `getFlashSaleStock(id)`     | `GET`                         | Read cached stock; returns `null` if key missing |
| `reserveProductStock(id)`   | Lua script (see below)        | Atomically decrement by 1 if stock is available  |
| `reserveFlashSaleStock(id)` | Lua script (see below)        | Atomically decrement by 1 if stock is available  |
| `releaseProductStock(id)`   | `INCRBY` (+1)                 | Roll back one unit after a failed DB step        |
| `releaseFlashSaleStock(id)` | `INCRBY` (+1)                 | Roll back one unit after a failed DB step        |

### Atomic reserve (Lua script)

Reservations use a single Lua script executed with `EVAL` so read-check-decrement is atomic under concurrency:

```lua
local current = redis.call('GET', KEYS[1])
if not current then
  return -2          -- key does not exist (cache miss)
end
current = tonumber(current)
if current <= 0 then
  return -1          -- out of stock
end
redis.call('DECR', KEYS[1])
return current - 1   -- new remaining stock after reserve
```

| Return value | Meaning                                                         | Application behavior                                            |
| ------------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `>= 0`       | Reserved successfully; value is remaining stock after decrement | Continue to PostgreSQL transaction                              |
| `-1`         | Out of stock in Redis                                           | Respond `409` with `{ "message": "out of stock" }`              |
| `-2`         | Key missing (cache not warmed)                                  | Load `stock` from PostgreSQL, `SET` the key, retry reserve once |

### When Redis keys are created or updated

| Event                               | Endpoint / code                                         | Redis action                                                                               |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Product created                     | `POST /products`                                        | `setProductStock(product.id, product.stock)`                                               |
| Flash sale created                  | `POST /flash-sale-products`                             | Decrements `products.stock` by flash sale `stock`; `setFlashSaleStock` + `setProductStock` |
| Flash sale stock updated            | `PATCH /flash-sale-products/:id` (when `stock` in body) | `setFlashSaleStock(id, updated.stock)`                                                     |
| Order placed (success)              | `POST /orders`                                          | After DB commit: `set*(id, dbStock - 1)` to align cache with PostgreSQL                    |
| Order cancelled                     | `PATCH /orders/:id` with `status: "cancelled"`          | DB `stock + 1`, then `release*` + `set*` to match DB                                       |
| Order failed after Redis reserve    | `POST /orders` catch block                              | `releaseProductStock` or `releaseFlashSaleStock`                                           |
| DB out of stock after Redis reserve | `POST /orders` (rollback path)                          | `ROLLBACK` + `release*`                                                                    |

`GET /products` does **not** read from Redis today; only write path and order flow use the product stock cache.

### Reading cached stock (API responses)

Flash sale list/detail endpoints attach live Redis values for clients:

- `GET /flash-sale-products` — each item includes `cached_stock`
- `GET /flash-sale-products/:id` — includes `cached_stock` and `is_active`

If the Redis key is missing, the API falls back to the `stock` column from PostgreSQL:

```text
cached_stock = redis_value ?? database_stock
```

This lets the UI show near-real-time availability without hitting the database for every read during a sale.

### Order placement flow (Redis + PostgreSQL)

```text
Client POST /orders
        |
        v
[1] Reserve in Redis (Lua DECR)  -----> 409 if out of stock / retry after warm
        |
        v
[2] BEGIN PostgreSQL transaction
        |
        v
[3] SELECT ... FOR UPDATE (products or flash_sale_products)
        |
        +---- stock <= 0 ----> ROLLBACK, release Redis (+1), 409
        |
        v
[4] UPDATE stock = stock - 1
        |
        v
[5] INSERT order (status: created)
        |
        v
[6] COMMIT
        |
        v
[7] setProductStock / setFlashSaleStock to match DB after decrement
```

**Regular product order** (`{ "productId": 1 }`):

- Reserves `product:stock:{productId}`
- Decrements `products.stock` in PostgreSQL
- Order row has `flash_sale_product_id = null`

**Flash sale order** (`{ "flashSaleProductId": 1 }`):

- Validates sale window (`start_date` / `end_date`)
- Reserves `flash_sale:stock:{flashSaleProductId}`
- Decrements `flash_sale_products.stock` in PostgreSQL (not `products.stock`)
- Order row stores `flash_sale_product_id` for correct cancel handling

### Order cancel flow (stock restore)

When `PATCH /orders/:id` sets `status` to `"cancelled"` and the order is still `created`:

1. If `flash_sale_product_id` is set: increment `flash_sale_products.stock` in PostgreSQL, then `releaseFlashSaleStock` + `setFlashSaleStock` from DB value.
2. Otherwise: increment `products.stock`, then `releaseProductStock` + `setProductStock` from DB value.

Marking an order as `paid` does **not** change stock (inventory was already deducted at order creation).

### Consistency model

| Layer          | Role                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | Authoritative inventory and orders; row-level locks (`FOR UPDATE`) prevent double-selling inside a transaction |
| **Redis**      | Optimistic fast path; rejects most oversell attempts before DB work                                            |

Important behaviors:

- **Cache miss (`-2`)**: Stock is loaded from PostgreSQL once, written to Redis, and reserve is retried. This handles cold starts or evicted keys without requiring a separate warm-up job.
- **Redis reserved but DB fails**: Redis is rolled back via `INCRBY` in the error handler or when DB reports zero stock after lock.
- **After successful order**: Redis is explicitly `SET` to the post-commit DB stock so the cache matches the database even if `DECR` and DB decrement diverged slightly under race.
- **No TTL reservations**: Unlike the architecture diagram above, this MVP does not use Redis TTL for unpaid holds; stock is deducted at order creation. Cancelling an order restores stock.

### Operational notes

- **Recreate DB volume after schema changes** (e.g. new `flash_sale_product_id` on `orders`):

  ```bash
  docker compose down -v
  docker compose up --build
  ```

- **Inspect cache in Redis CLI**:

  ```bash
  docker exec -it flash_sale_redis redis-cli GET product:stock:1
  docker exec -it flash_sale_redis redis-cli GET flash_sale:stock:1
  ```

- **Health check**: `GET /health` returns `{ "status": "ok" }` only if both PostgreSQL (`SELECT 1`) and Redis (`PING`) succeed.

## Additional Resources

For detailed instructions on setting up and running the frontend client, please refer to the frontend repository:

- Frontend Repository: https://github.com/jaisanas/fe-flesh-sale

To better understand the overall system architecture and how the frontend and backend services communicate with each other, you can watch the walkthrough video below:

- System Walkthrough Video: https://drive.google.com/file/d/1h_hg97l9VC9MPoN9snwHo61K_NWf_OGv/view?usp=sharing
