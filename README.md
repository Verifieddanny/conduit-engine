# Conduit

A source-agnostic webhook relay service that receives, stores, and reliably delivers webhook events to registered endpoints with retry logic, payload signing, and full delivery logs.

## What It Does

External services (Stripe, GitHub, Paystack, or any custom source) send webhook events to Conduit. Conduit stores the event immediately, then delivers it to all registered endpoints subscribed to that event type. If an endpoint is down, Conduit retries with exponential backoff. After repeated failures, the delivery moves to a dead letter queue for manual inspection and replay.

**The core value:** Your application server can go down, redeploy, or crash -- Conduit holds your events and keeps retrying until they're delivered. Every delivery attempt is logged for full observability.

## How It Works

```
External Service (Stripe, GitHub, etc.)
        |
        v
    Conduit Relay
        |
        ├── Stores event to PostgreSQL (write-ahead persistence)
        ├── Looks up subscribed endpoints
        ├── Creates delivery record per endpoint
        └── Pushes to Redis queue
                |
                v
        BullMQ Worker (background process)
                |
                ├── Sends POST to endpoint URL
                ├── Signs payload with HMAC-SHA256
                ├── Checks response
                ├── ✅ 2xx → Mark as delivered
                └── ❌ Failure → Schedule retry
                        |
                        ├── Attempt 1: 10s
                        ├── Attempt 2: 30s
                        ├── Attempt 3: 2min
                        ├── Attempt 4: 10min
                        ├── Attempt 5: 1hr
                        └── After 5 failures → Dead letter queue
```

## Tech Stack

- **Runtime:** Bun
- **Framework:** Express 5
- **Language:** TypeScript
- **Database:** PostgreSQL (via Docker)
- **ORM:** Drizzle ORM
- **Queue:** Redis + BullMQ (coming soon)
- **Auth:** JWT (session) + SHA-256 hashed API keys (programmatic access)
- **Payload Signing:** HMAC-SHA256
- **Validation:** express-validator

## Current Progress

- [x] Project setup (Bun + TypeScript + Express 5)
- [x] PostgreSQL database with Drizzle ORM schema
- [x] User registration and login (bcrypt + JWT)
- [x] API key generation with SHA-256 hashing (`cdt_` prefixed keys)
- [x] API key authentication middleware
- [ ] Endpoint CRUD (register, update, delete, list)
- [ ] Inbound event receiver
- [ ] Redis + BullMQ integration
- [ ] Background worker for delivery
- [ ] Retry logic with exponential backoff + jitter
- [ ] HMAC-SHA256 payload signing
- [ ] Delivery logs and analytics
- [ ] Dead letter queue management
- [ ] Event simulator for testing
- [ ] Dashboard frontend

## Database Schema

**User** -- registers and authenticates via API key

| Field | Type | Details |
|-------|------|---------|
| id | bigint | Primary key, auto-generated |
| username | varchar(255) | Unique |
| email | varchar(255) | Unique |
| password | varchar | bcrypt hashed |
| api_key | varchar | SHA-256 hashed, unique |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-set |

**Endpoint** -- a URL registered to receive webhooks

| Field | Type | Details |
|-------|------|---------|
| id | bigint | Primary key, auto-generated |
| endpoint_path | text | The URL to deliver webhooks to |
| secret | varchar | Used for HMAC-SHA256 payload signing |
| status | enum | `active` or `inactive` |
| subscribed_event | text[] | Array of event types to listen for |
| external_source | text | Label for the webhook source (e.g., "stripe") |
| user_id | bigint | Foreign key to User |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-set |

**Callback** -- a single delivery attempt

| Field | Type | Details |
|-------|------|---------|
| id | bigint | Primary key, auto-generated |
| status | enum | `pending`, `delivered`, `failed`, `dead` |
| response_code | varchar | HTTP status code from endpoint |
| response_body | text | Response body from endpoint |
| attempts | integer | Number of delivery attempts (default: 0) |
| next_retry | timestamp | When to retry next (with timezone) |
| payload | text | JSON stringified webhook payload |
| event_type | varchar | The event type that triggered this delivery |
| endpoint_id | bigint | Foreign key to Endpoint |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-set |

## API Endpoints

### Auth

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | None | Create account |
| GET | `/api/auth/login` | None | Login, receive JWT |
| PUT | `/api/auth/api-key` | JWT | Generate API key (shown once) |

### Endpoints (coming soon)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/endpoints` | API Key | Register a new endpoint |
| GET | `/api/endpoints` | API Key | List all endpoints |
| GET | `/api/endpoints/:id` | API Key | Get endpoint details |
| PATCH | `/api/endpoints/:id` | API Key | Update endpoint |
| DELETE | `/api/endpoints/:id` | API Key | Delete endpoint |

### Events (coming soon)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/inbound/:endpointId` | None | Receive webhook from external source |

### Deliveries (coming soon)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/deliveries` | API Key | List delivery logs |
| POST | `/api/deliveries/:id/replay` | API Key | Replay a failed delivery |

## Setup

### Prerequisites

- [Bun](https://bun.sh/) installed
- Docker (for PostgreSQL)

### Run Locally

```bash
# Clone
git clone https://github.com/Verifieddanny/conduit-engine.git
cd webhook-delivery-engine

# Install dependencies
bun install

# Start PostgreSQL
docker run --name webhook-relay -e POSTGRES_DB=webhook-relay-db -e POSTGRES_USER=webhook-admin -e POSTGRES_PASSWORD=yourpassword -p 5433:5432 -d postgres:alpine

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL and JWT secret

# Push schema
bunx drizzle-kit push

# Start dev server
bun dev
```

### Environment Variables

```
DATABASE_URL=postgresql://<username>:<yourpassword>@localhost:5433/<db_name>
SECRET=your-jwt-secret
PORT=8080
```

## Project Structure

```
src/
├── controller/
│   └── auth.ts          # Register, login, API key generation
├── db/
│   ├── index.ts         # Database connection (pg Pool + Drizzle)
│   └── schema.ts        # Drizzle schema definitions
├── middleware/
│   ├── has-api-key.ts   # API key authentication
│   └── is-auth.ts       # JWT authentication
├── routes/
│   └── auth.ts          # Auth route definitions
├── shared/
│   └── types.ts         # TypeScript interfaces
└── index.ts             # Express app entry point
```

## Author

**Danny (DevDanny)** -- [@dannyclassi_c](https://x.com/dannyclassi_c)

## LIiscence

MIT

Previous projects: [URL Shortener](https://github.com/Verifieddanny/url-shortener) | [NexusChat](https://github.com/Verifieddanny/chat-app-BE) | [Shipyard](https://github.com/Verifieddanny/cicd-engine)