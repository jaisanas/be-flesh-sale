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
