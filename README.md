# Conduit

A source-agnostic webhook relay service that receives, stores, and reliably delivers webhook events to registered endpoints with retry logic, payload signing, and full delivery logs.

## What It Does

External services (Stripe, GitHub, Paystack, or any custom source) send webhook events to Conduit. Conduit stores the event immediately, then delivers it to all registered endpoints subscribed to that event type. If an endpoint is down, Conduit retries with exponential backoff + jitter. After repeated failures, the delivery moves to a dead letter queue for manual inspection and replay.

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
                ├── Signs payload with HMAC-SHA256 (cdtsig_sha256=...)
                ├── Sends POST to endpoint URL (10s timeout)
                ├── Attaches headers (X-Conduit-Signature, X-Conduit-Event, X-Conduit-Callback-Id)
                ├── Captures response code + body
                ├── ✅ 2xx → Mark as delivered
                └── ❌ Failure → Retry with exponential backoff + jitter
                        |
                        ├── Attempt 1: ~10s + jitter
                        ├── Attempt 2: ~30s + jitter
                        ├── Attempt 3: ~2min + jitter
                        ├── Attempt 4: ~10min + jitter
                        ├── Attempt 5: ~1hr + jitter
                        └── After 5 failures → Dead letter queue (status: "dead")
                                |
                                └── Manual replay via POST /api/deliveries/:id/replay
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
- **Auth:** JWT (dashboard) + SHA-256 hashed API keys (programmatic access)
- **Encryption:** AES-256-GCM (endpoint secrets)
- **Outbound Signing:** HMAC-SHA256 with `cdtsig_sha256=` prefix
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
- [x] Endpoint CRUD (create, list, get by ID, update, delete with ownership verification)
- [x] Inbound event receiver with auto-detection of 5 webhook sources
- [x] Source-specific signature verification (GitHub, Stripe, Paystack, Slack, Shopify)
- [x] Raw body buffer capture for accurate signature verification
- [x] Replay attack detection (Stripe, Slack)
- [x] Event simulator for testing (API key authenticated, ownership verified)
- [x] Redis + BullMQ integration (producer-consumer pattern)
- [x] Background worker for delivery (separate process, concurrency: 5)
- [x] Outbound webhook delivery with 10s timeout and custom headers
- [x] HMAC-SHA256 payload signing for outbound delivery (`cdtsig_sha256=`)
- [x] Callback status tracking (pending → delivered/failed/dead)
- [x] Retry logic with exponential backoff + jitter
- [x] Dead letter queue (status: "dead" after 5 failures)
- [x] Delivery logs (list callbacks per endpoint)
- [x] Manual replay for failed/dead deliveries
- [x] Dashboard stats endpoint (total endpoints, deliveries, success/failure/dead counts)
- [x] Recent deliveries endpoint (last 10 across all endpoints)
- [x] Dual auth routing (JWT for dashboard, API key for programmatic access)
- [ ] Status filtering on delivery logs
- [ ] Frontend deployment

## Database Schema

**User** -- registers and authenticates via API key or JWT

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
| secret | varchar | AES-256-GCM encrypted, used for HMAC-SHA256 signing |
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

### Endpoints (Programmatic — API Key)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/endpoints` | API Key | Register a new endpoint |
| GET | `/api/endpoints` | API Key | List all endpoints with delivery stats |
| GET | `/api/endpoints/:id` | API Key | Get endpoint with delivery stats |
| PUT | `/api/endpoints/:id` | API Key | Update endpoint |
| DELETE | `/api/endpoints/:id` | API Key | Delete endpoint |

### Endpoints (Dashboard — JWT)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/dashboard/endpoints` | JWT | Register a new endpoint |
| GET | `/api/dashboard/endpoints` | JWT | List all endpoints with delivery stats |
| GET | `/api/dashboard/endpoints/:id` | JWT | Get endpoint with delivery stats |
| PUT | `/api/dashboard/endpoints/:id` | JWT | Update endpoint |
| DELETE | `/api/dashboard/endpoints/:id` | JWT | Delete endpoint |

### Inbound Events

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/inbound/:endpointId` | Webhook Signature | Receive webhook from external source |

### Simulator

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/simulator/:endpointId` | API Key | Simulate a webhook event (programmatic) |
| POST | `/api/dashboard/simulator/:endpointId` | JWT | Simulate a webhook event (dashboard) |

### Deliveries (Programmatic — API Key)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/deliveries/stats` | API Key | Aggregate delivery stats across all endpoints |
| GET | `/api/deliveries/recent` | API Key | Last 10 deliveries across all endpoints |
| GET | `/api/deliveries/:endpointId` | API Key | List delivery logs for an endpoint |
| POST | `/api/deliveries/:callbackId/replay` | API Key | Replay a failed or dead delivery |

### Deliveries (Dashboard — JWT)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/dashboard/deliveries/stats` | JWT | Aggregate delivery stats across all endpoints |
| GET | `/api/dashboard/deliveries/recent` | JWT | Last 10 deliveries across all endpoints |
| GET | `/api/dashboard/deliveries/:endpointId` | JWT | List delivery logs for an endpoint |
| POST | `/api/dashboard/deliveries/:callbackId/replay` | JWT | Replay a failed or dead delivery |

## Delivery Headers

When Conduit delivers a webhook to your endpoint, the following custom headers are attached:

| Header | Description |
|--------|-------------|
| `X-Conduit-Signature` | HMAC-SHA256 signature of the payload (`cdtsig_sha256=...`) |
| `X-Conduit-Event` | The event type (e.g., `payment.failed`, `order.created`) |
| `X-Conduit-Callback-Id` | Unique callback ID for referencing this delivery in logs |
| `Content-Type` | Always `application/json` |

### Verifying Signatures

To verify that a webhook delivery came from Conduit, compute the HMAC-SHA256 of the raw request body using your endpoint's secret and compare it to the `X-Conduit-Signature` header:

```javascript
const crypto = require('crypto');

const signature = req.headers['x-conduit-signature'];
const hmac = crypto.createHmac('sha256', YOUR_ENDPOINT_SECRET);
const expected = 'cdtsig_sha256=' + hmac.update(req.rawBody).digest('hex');

if (signature !== expected) {
  return res.status(401).send('Invalid signature');
}
```

## Retry Logic

Failed deliveries are retried with exponential backoff + full jitter (AWS recommended):

| Attempt | Base Delay | Actual Delay (with jitter) |
|---------|-----------|---------------------------|
| 1 | 10s | 10s – 20s |
| 2 | 30s | 30s – 60s |
| 3 | 2min | 2min – 4min |
| 4 | 10min | 10min – 20min |
| 5 | 1hr | 1hr – 2hr |

After 5 failed attempts, the callback status moves to `dead`. Dead callbacks can be manually replayed via the API.

**Formula:** `nextRetry = baseDelay + (Math.random() × baseDelay)`

Jitter prevents the thundering herd problem — when many failed deliveries all retry at the exact same moment and overwhelm the recovering endpoint.

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
│   ├── deliveries.ts        # Delivery logs, replay, stats, recent deliveries
│   ├── endpoint.ts          # Endpoint CRUD (create, list, get, update, delete)
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
│   ├── deliveries.ts        # Delivery log, replay, stats, recent routes
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

**Dual Auth Routing.** The same controllers serve both programmatic (API key) and dashboard (JWT) consumers. Routes are mounted twice under different prefixes with different auth middleware — `/api/endpoints` uses `hasApiKey`, `/api/dashboard/endpoints` uses `isAuth`. No code duplication.

**Write-ahead persistence.** Every inbound event is written to PostgreSQL before being queued. If Redis is unavailable or the worker is down, events are still recorded and can be replayed.

**Concurrency.** The worker processes up to 5 jobs in parallel. Slow endpoints don't block faster ones.

**Timeout protection.** Each delivery has a 10 second timeout using `AbortSignal.timeout()`. Unresponsive endpoints fail fast instead of hanging the worker.

**Outbound signing.** Every outbound delivery is HMAC-SHA256 signed using the endpoint's decrypted secret. Recipients can verify webhooks came from Conduit by checking the `X-Conduit-Signature` header.

**Dead letter recovery.** Failed deliveries that exhaust all retries are marked as "dead" and can be manually replayed via the API. Events are never lost.

## Author

**Danny (DevDanny)** -- [@dannyclassi_c](https://x.com/dannyclassi_c)

## License

MIT

Previous projects: [URL Shortener](https://github.com/Verifieddanny/url-shortener) | [NexusChat](https://github.com/Verifieddanny/chat-app-BE) | [Shipyard](https://github.com/Verifieddanny/cicd-engine)