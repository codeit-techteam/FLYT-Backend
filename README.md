# FLYT Backend

Production-oriented modular monolith for the FLYT Mobility Platform.

Stack: **Node.js · Express · TypeScript · Prisma · PostgreSQL/PostGIS · Redis · Socket.IO · BullMQ · Zod · Pino**

## Quick start

### 1. Prerequisites

- Node.js 20+
- Docker Desktop (PostgreSQL + Redis)

### 2. Environment

```bash
cp .env.example .env
```

Defaults are safe for local development only.

### 3. Start infrastructure

```bash
docker compose up -d postgres redis
```

PostgreSQL: `localhost:5432` · Redis: `localhost:6380` (host port avoids clashes with other local Redis instances; container still listens on 6379).

### 4. Install & migrate

```bash
npm install
npx prisma migrate deploy
npx prisma db seed
```

If this is the first local migration generation:

```bash
npx prisma migrate dev --name init
npm run postgis:enable
npx prisma db seed
```

### 5. Run API + worker

```bash
npm run dev
# separate terminal
npm run dev:worker
```

API: http://localhost:5050  
Health: http://localhost:5050/health  
Swagger: http://localhost:5050/docs  
OpenAPI: http://localhost:5050/openapi.yaml

> Note: macOS often binds port `5000` to AirPlay Receiver. Local default is **5050**.

### Docker (full stack)

```bash
docker compose up --build
```

Stop:

```bash
docker compose down
```

Remove volumes (destroys local DB data):

```bash
docker compose down -v
```

## Development login

| Actor | Method | Credentials |
|-------|--------|-------------|
| Admin | `POST /api/v1/auth/admin/login` | `admin@flyt.local` / `Admin@Flyt2026!` |
| Customer | OTP | phone `+919876543210` — OTP returned as `devOtp` when `OTP_PROVIDER=development` |
| She+Silver customer | OTP | `+919876543211` |
| Pilot | OTP | `+919800011122` |
| She Pilot | OTP | `+919800011133` |

## Architecture

```
src/
  config/           env, db, redis, socket, logger
  modules/          auth, customers, pilots, bookings, matching, dispatch, trips, pricing, payments, …
  common/           middleware, errors, utils
  infrastructure/   SMS, maps, payments, storage, push, queues
  workers/          BullMQ consumers
```

- PostgreSQL is the source of truth for rides, payments, and ledger entries.
- Redis holds hot pilot locations, rate limits, dispatch coordination, Socket.IO adapter, and BullMQ.
- PostGIS `geography(Point,4326)` + GiST powers nearby pilot search (not lat/lng bounding boxes alone).
- Socket.IO emits realtime events; clients never authoritatively change ride state.

## Key API groups (`/api/v1`)

- Auth: send/verify OTP, refresh, logout, admin login
- Customers / Pilots / Admin profiles & ops
- Rides: quote → create → cancel → lifecycle
- Pilot offers: accept / reject (atomic assignment)
- Payments: order, verify, Razorpay webhook
- Safety: SOS, trip share

## Modes

- **Standard** — default matching
- **She** — female rider; female-pilot eligibility is a hard filter; fallback policy is configurable
- **Silver** — age 60+ with **verified** DOB; **10% discount calculated server-side only**
- Combined She + Silver rules are supported when both eligibilities hold

## Matching score (configurable weights)

`Score = 0.40E + 0.20D + 0.15R + 0.15A + 0.10Q`

Eligibility is applied as a hard filter before ranking.

## Payments & ledger

- Razorpay adapter + development mock provider
- Webhook signature verification + idempotent `WebhookEvent` rows
- Double-entry ledger; corrections via reversal entries
- Commission percent comes from pricing configuration (seeded at 20% for illustration)

Marketplace vendor settlements are **not** assumed from Razorpay alone.

## Workers

```bash
npm run dev:worker
```

Jobs: offer expiry, dispatch retry, payment webhooks, push notifications, location history cleanup.

## Tests

```bash
# infra must be up
docker compose up -d postgres redis
npm test
```

## Production notes (DigitalOcean + Cloudflare)

1. Managed PostgreSQL with PostGIS; never expose publicly.
2. Managed Redis/Valkey; private network only.
3. API + worker processes (separate Dyno/Droplet/App Platform services).
4. Cloudflare DNS + SSL/TLS + WAF in front of Nginx reverse proxy (`docker/nginx/flyt.conf`).
5. R2 for private KYC/document storage (presigned URLs).
6. Set production provider env vars (`OTP_PROVIDER=msg91`, `PAYMENT_PROVIDER=razorpay`, etc.).
7. Run `npx prisma migrate deploy` on release.

See `docker/compose.production.example.yml` for a reference layout. Do not deploy without credentials and approval.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | API hot reload |
| `npm run dev:worker` | Worker hot reload |
| `npm run build` | Compile TypeScript |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run prisma:migrate` | Create/apply migrations |
| `npm run prisma:seed` | Seed development data |
| `npm run postgis:enable` | Add geom column + GiST index |

## External credentials required from client

| Integration | Variables |
|-------------|-----------|
| MSG91 | `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_TEMPLATE_ID` |
| Google Maps / Routes | `GOOGLE_MAPS_API_KEY` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Firebase | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` |

Without these, development adapters are used and the API remains fully operable locally.
