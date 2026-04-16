# Conduit

A source-agnostic webhook relay service that receives, stores, and reliably delivers webhook events to registered endpoints with retry logic, payload signing, and full delivery logs.

## What It Does

External services (Stripe, GitHub, Paystack, or any custom source) send webhook events to Conduit. Conduit stores the event immediately, then delivers it to all registered endpoints subscribed to that event type. If an endpoint is down, Conduit retries with exponential backoff. After repeated failures, the delivery moves to a dead letter queue for manual inspection and replay.

**The core value:** Your application server can go down, redeploy, or crash -- Conduit holds your events and keeps retrying until they're delivered. Every delivery attempt is logged for full observability.

## How It Works

Conduit uses a **producer-consumer architecture**. The API server (producer) accepts incoming webhooks and pushes jobs to a Redis queue. A separate worker process (consumer) pulls jobs from the queue and delivers them. Both processes can scale and fail independently.

```
External Service (Stripe, GitHub, etc.)
        |
        v
    Conduit API (/api/inbound/:endpointId)  ── PRODUCER
        |
        ├── Auto-detects source via request headers
        ├── Verifies webhook signature (HMAC)
        ├── Stores event to PostgreSQL (write-ahead persistence)
        ├── Creates callback record per subscribed endpoint
        └── Pushes job to Redis queue (BullMQ)
                |
                v
        Conduit Worker (separate process)  ── CONSUMER
                |
                ├── Pulls job from queue (concurrency: 5)
                ├── Fetches callback + endpoint from DB
                ├── Sends POST to endpoint URL (10s timeout)
                ├── Attaches custom headers (X-Conduit-Event, X-Conduit-Callback-Id)
                ├── Captures response code + body
                ├── ✅ 2xx → Mark as delivered
                └── ❌ Failure → Schedule retry (coming soon)
                        |
                        ├── Attempt 1: 10s
                        ├── Attempt 2: 30s
                        ├── Attempt 3: 2min
                        ├── Attempt 4: 10min
                        ├── Attempt 5: 1hr
                        └── After 5 failures → Dead letter queue
```

## Supported Webhook Sources

Conduit auto-detects the external source by inspecting request headers. No configuration needed -- just point your webhook URL at Conduit.

| Source | Signature Header | Algorithm | Replay Protection |
|--------|-----------------|-----------|-------------------|
| GitHub | `x-hub-signature-256` | HMAC-SHA256 (hex) | No |
| Stripe | `stripe-signature` | HMAC-SHA256 (hex) | Yes (5min window) |
| Paystack | `x-paystack-signature` | HMAC-SHA512 (hex) | No |
| Slack | `x-slack-signature` | HMAC-SHA256 (hex) | Yes (5min window) |
| Shopify | `x-shopify-hmac-sha256` | HMAC-SHA256 (base64) | No |

## Tech Stack

- **Runtime:** Bun
- **Framework:** Express 5
- **Language:** TypeScript
- **Database:** PostgreSQL (via Docker)
- **ORM:** Drizzle ORM
- **Queue:** Redis + BullMQ
- **Auth:** JWT (session) + SHA-256 hashed API keys (programmatic access)
- **Encryption:** AES-256-GCM (endpoint secrets)
- **Signature Verification:** Source-specific HMAC verification with raw body buffer
- **Validation:** express-validator

## Current Progress

- [x] Project setup (Bun + TypeScript + Express 5)
- [x] PostgreSQL database with Drizzle ORM schema (UUID primary keys)
- [x] User registration and login (bcrypt + JWT)
- [x] Input validation (express-validator)
- [x] API key generation with SHA-256 hashing (`cdt_` prefixed keys)
- [x] API key authentication middleware
- [x] AES-256-GCM encryption service (for endpoint secrets)
- [x] Endpoint CRUD (create, list, update, delete with ownership verification)
- [x] Inbound event receiver with auto-detection of 5 webhook sources
- [x] Source-specific signature verification (GitHub, Stripe, Paystack, Slack, Shopify)
- [x] Raw body buffer capture for accurate signature verification
- [x] Replay attack detection (Stripe, Slack)
- [x] Event simulator for testing (API key authenticated, ownership verified)
- [x] Redis + BullMQ integration (producer-consumer pattern)
- [x] Background worker for delivery (separate process, concurrency: 5)
- [x] Outbound webhook delivery with 10s timeout and custom headers
- [x] Callback status tracking (pending → delivered/failed)
- [ ] Retry logic with exponential backoff + jitter
- [ ] HMAC-SHA256 payload signing for outbound delivery
- [ ] Delivery logs and analytics
- [ ] Dead letter queue management
- [ ] Dashboard frontend

## Database Schema

**User** -- registers and authenticates via API key

| Field | Type | Details |
|-------|------|---------|
| id | uuid | Primary key, auto-generated |
| username | varchar(255) | Unique |
| email | varchar(255) | Unique |
| password | varchar | bcrypt hashed |
| api_key | varchar | SHA-256 hashed, unique |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-set |

**Endpoint** -- a URL registered to receive webhooks

| Field | Type | Details |
|-------|------|---------|
| id | uuid | Primary key, auto-generated |
| endpoint_path | text | The URL to deliver webhooks to |
| secret | varchar | AES-256-GCM encrypted, used for signature verification |
| status | enum | `active` or `inactive` |
| subscribed_event | text[] | Array of event types to listen for |
| external_source | text | Label for the webhook source (e.g., "stripe", "github", "simulator") |
| user_id | uuid | Foreign key to User |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-set |

**Callback** -- a single delivery attempt

| Field | Type | Details |
|-------|------|---------|
| id | uuid | Primary key, auto-generated |
| status | enum | `pending`, `delivered`, `failed`, `dead` |
| response_code | varchar | HTTP status code from endpoint |
| response_body | text | Response body from endpoint (capped at 1000 chars) |
| attempts | integer | Number of delivery attempts (default: 0) |
| next_retry | timestamp | When to retry next (with timezone) |
| payload | text | JSON stringified webhook payload |
| event_type | varchar | The event type that triggered this delivery |
| endpoint_id | uuid | Foreign key to Endpoint |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-set |

## API Endpoints

### Auth

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | None | Create account |
| POST | `/api/auth/login` | None | Login, receive JWT |
| PUT | `/api/auth/api-key` | JWT | Generate API key (shown once) |

### Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/endpoints` | API Key | Register a new endpoint |
| GET | `/api/endpoints` | API Key | List all endpoints |
| PUT | `/api/endpoints/:id` | API Key | Update endpoint |
| DELETE | `/api/endpoints/:id` | API Key | Delete endpoint |

### Inbound Events

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/inbound/:endpointId` | Webhook Signature | Receive webhook from external source |

### Simulator

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/simulator/:endpointId` | API Key | Simulate a webhook event for testing |

### Deliveries (coming soon)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/deliveries` | API Key | List delivery logs |
| POST | `/api/deliveries/:id/replay` | API Key | Replay a failed delivery |

## Delivery Headers

When Conduit delivers a webhook to your endpoint, the following custom headers are attached:

| Header | Description |
|--------|-------------|
| `X-Conduit-Event` | The event type (e.g., `payment.failed`, `order.created`) |
| `X-Conduit-Callback-Id` | Unique callback ID for referencing this delivery in logs |
| `Content-Type` | Always `application/json` |

## Setup

### Prerequisites

- [Bun](https://bun.sh/) installed
- Docker (for PostgreSQL and Redis)

### Run Locally

```bash
# Clone
git clone https://github.com/Verifieddanny/conduit-engine.git
cd conduit-engine

# Install dependencies
bun install

# Start PostgreSQL
docker run --name conduit-db -e POSTGRES_DB=conduit-db -e POSTGRES_USER=conduit-admin -e POSTGRES_PASSWORD=yourpassword -p 5433:5432 -d postgres:alpine

# Start Redis
docker run --name conduit-redis -p 6379:6379 -d redis:alpine

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL, JWT secret, and encryption key

# Push schema
bunx drizzle-kit push

# Start API server (Terminal 1)
bun dev

# Start worker (Terminal 2)
bun worker
```

### Environment Variables

```
DATABASE_URL=postgresql://<username>:<yourpassword>@localhost:5433/<db_name>
SECRET_KEY=your-jwt-secret
ENCRYPTION_KEY=your-64-char-hex-key  # Must be 32 bytes when decoded from hex
REDIS_HOST=localhost                  # Optional, defaults to localhost
REDIS_PORT=6379                       # Optional, defaults to 6379
PORT=8080
```

**Note:** `ENCRYPTION_KEY` must be a 64-character hex string (32 bytes when decoded). Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Start API server with watch mode |
| `bun worker` | Start background worker with watch mode |
| `bun start` | Start API server in production |
| `bun build` | Compile TypeScript |
| `bun db:push` | Push schema changes to database |
| `bun db:generate` | Generate migration files |
| `bun db:studio` | Open Drizzle Studio |

## Project Structure

```
src/
├── controller/
│   ├── auth.ts              # Register, login, API key generation
│   ├── endpoint.ts          # Endpoint CRUD operations
│   ├── inbound.ts           # Inbound webhook handler (auto-detect source)
│   └── simulator.ts         # Event simulator for testing
├── db/
│   ├── index.ts             # Database connection (pg Pool + Drizzle)
│   └── schema.ts            # Drizzle schema definitions
├── middleware/
│   ├── has-api-key.ts       # API key authentication
│   └── is-auth.ts           # JWT authentication
├── queue/
│   └── delivery.ts          # BullMQ queue setup + Redis connection
├── routes/
│   ├── auth.ts              # Auth route definitions
│   ├── endpoint.ts          # Endpoint route definitions
│   ├── inbound.ts           # Inbound webhook routes
│   └── simulator.ts         # Simulator routes
├── service/
│   ├── encryption.ts        # AES-256-GCM encrypt/decrypt
│   └── verifyWebhook.ts     # Source-specific signature verification
├── shared/
│   └── types.ts             # TypeScript interfaces
├── validation/
│   ├── auth.ts              # Auth input validation
│   ├── endpoint.ts          # Endpoint input validation
│   └── simulator.ts         # Simulator input validation
├── index.ts                 # API server entry point (producer)
└── worker.ts                # Background worker entry point (consumer)
```

## Architecture Notes

**Producer-Consumer Pattern.** The API server and worker are completely independent processes that communicate only through Redis. The API server pushes jobs and returns immediately. The worker pulls jobs and delivers webhooks. Either can crash, restart, or scale independently without affecting the other.

**Write-ahead persistence.** Every inbound event is written to PostgreSQL before being queued. If Redis is unavailable or the worker is down, events are still recorded and can be replayed.

**Concurrency.** The worker processes up to 5 jobs in parallel. Slow endpoints don't block faster ones.

**Timeout protection.** Each delivery has a 10 second timeout using `AbortSignal.timeout()`. Unresponsive endpoints fail fast instead of hanging the worker.

## Author

**Danny (DevDanny)** -- [@dannyclassi_c](https://x.com/dannyclassi_c)

## License

MIT

Previous projects: [URL Shortener](https://github.com/Verifieddanny/url-shortener) | [NexusChat](https://github.com/Verifieddanny/chat-app-BE) | [Shipyard](https://github.com/Verifieddanny/cicd-engine)