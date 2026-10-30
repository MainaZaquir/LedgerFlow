# LedgerFlow

**Simulated, merchant-isolated payment API** with deterministic provider behavior, PostgreSQL-backed idempotency, authenticated webhooks, a double-entry ledger, and persistent reconciliation.

> No real money, payment credentials, cardholder data, or live provider integration. This is an engineering portfolio application, **not** a compliant payment processor. The delivered copy was created in an environment without working npm registry DNS, Docker, or PostgreSQL; tests were authored but could **not** be run there. See [docs/BUILD_LOG.md](docs/BUILD_LOG.md) for explicit evidence and verification limitations.

## Architecture at a glance

Express routes and Zod validation → merchant services → Prisma transactions → PostgreSQL. The deterministic simulator durably reserves one provider operation per payment. Signed webhooks and recovered provider outcomes share transactionally safe payment-state and ledger-posting logic. Reconciliation imports CSV data and classifies mismatches without rewriting historical transactions.

For deeper explanation, read [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), and [interview guide](docs/INTERVIEW_GUIDE.md).

## Prerequisites and start

Node.js 22+, npm, Docker with Docker Compose v2. Use only **local development credentials** and replace the example webhook secret.

```bash
cp .env.example .env
# Edit SIMULATOR_WEBHOOK_SECRET to a random 32+ character value.
npm install                        # generates package-lock.json if missing
npm run db:generate
# Start PostgreSQL locally. Make sure port 5432 is available.
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run db:key -- demo-one       # displays a newly issued secret ONCE
npm run dev
```

For an all-container runtime, after dependencies/lockfile have been installed/generated:

```bash
docker compose up --build -d
# API container runs prisma migrate deploy then serves requests.
# Seed/issue keys from the host (DATABASE_URL points to localhost) as above.
```

> The initial distribution **does not include an npm lockfile**. The npm registry was inaccessible in the build environment. Running `npm install` on a connected development machine is an explicit prerequisite; **commit the resulting lockfile before running `npm ci` or CI**. Dockerfile and GitHub Actions intentionally require the lockfile to prevent nondeterministic CI installs. This is a known delivery blocker, not a completed acceptance item.

## HTTP endpoints

Base URL `http://localhost:3000`, API root `/api/v1`. Swagger UI: `http://localhost:3000/docs`. Raw OpenAPI: `http://localhost:3000/openapi.json`. Operational: `GET /health` and `GET /ready` (database query).

| Area             | Endpoints                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments         | `POST /payments`, `GET /payments`, `GET /payments/:id`, `POST /payments/:id/cancel`, `POST /payments/:id/verify`                                                             |
| Provider webhook | `POST /webhooks/provider/simulator` (signature, **not** merchant bearer authentication)                                                                                      |
| Ledger           | `GET /ledger/transactions`, `GET /ledger/transactions/:id`                                                                                                                   |
| Reconciliation   | `POST /reconciliation/imports`, `POST /reconciliation/runs`, `GET /reconciliation/runs/:id`, `GET /reconciliation/exceptions`, `POST /reconciliation/exceptions/:id/resolve` |

`/payments` and `/ledger/...` in the table are relative to `/api/v1`.

### Example payment

```bash
export LEDGERFLOW_KEY='paste-newly-issued-lf_test_key-here'
curl -sS -X POST http://localhost:3000/api/v1/payments \
  -H "Authorization: Bearer $LEDGERFLOW_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: invoice-2026-001' \
  -d '{"amount":"2500","currency":"KES","scenario":"success"}'
```

Amount `2500` is 25.00 KES, as decimal **minor units**. API returns minor-unit amounts as **strings**, not floating-point values. `JPY` has zero fractional places; `KWD` has three. Maximum per operation is 1,000,000,000,000 minor units. The example simulator outcome is `SUCCEEDED` and posts one balanced two-entry ledger transaction.

Repeat the exact request and key to receive the same payment ID; change the amount and keep the key to receive HTTP 409.

### Webhook verification

Provider events are signed over the **exact JSON bytes** with HMAC-SHA256:

```bash
# Use the resulting payment ID and its providerTransactionId:
export PAYMENT_ID='paste-payment-id'
export PROVIDER_ID="sim-$PAYMENT_ID"
export SIMULATOR_WEBHOOK_SECRET='same-secret-as-in-.env'
node - <<'JS'
const { createHmac } = require('node:crypto');
const body = JSON.stringify({eventId:'demo-event-001',paymentId:process.env.PAYMENT_ID,externalId:process.env.PROVIDER_ID,outcome:'SUCCEEDED'});
const signature = 'sha256=' + createHmac('sha256',process.env.SIMULATOR_WEBHOOK_SECRET).update(body).digest('hex');
console.log('Signature:',signature,'\nBody:',body);
JS
# Send printed signature and body without changing a byte:
# curl -X POST /api/v1/webhooks/provider/simulator ...
```

Run `scenario: "processing"` to keep the payment in `PROCESSING` until a signed terminal event arrives. `timeout` and `timeout-after-accept` intentionally remain ambiguous (`PROCESSING`). `POST /payments/:id/verify` never resends provider operations; it only consumes durable terminal provider facts. `hold` creates `PENDING` for demonstration of safe cancellation without provider submission.

### Complete demonstrator

With the server and seeded database running, set the secret in your shell and run:

```bash
npm run workflow
```

This command issues and revokes a temporary demo key, creates a processing payment, submits a signed success event, imports a two-row report, runs reconciliation and prints resulting IDs. The report includes a deliberately unmatched external transaction. `samples/provider-report.csv` also provides a fixture for inspection; replace its placeholder ID before using it for an actual match.

## Testing and quality commands

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:unit
# Create dedicated ledgerflow_test database, migrate with DATABASE_URL pointing to it.
DATABASE_URL="$DATABASE_URL_TEST" npm run db:migrate
npm run test:integration   # requires DATABASE_URL_TEST containing ledgerflow_test
npm test                   # all test files, including PostgreSQL integration
```

To create the test database (while the Compose PostgreSQL container runs):

```bash
docker compose exec -T db psql -U ledgerflow -d ledgerflow -c 'CREATE DATABASE ledgerflow_test;'
```

The test helper refuses cleanup if the test URL does not contain `ledgerflow_test`, and truncates only that test database's merchant-owned tables. **Never point tests at an important database.** The CI service starts a dedicated PostgreSQL test instance and applies migrations before running tests. CI still requires the lockfile to be generated and committed.

For local shutdown: `docker compose down`. To **irreversibly delete local database volumes**: `docker compose down -v` (only with explicit intent). Stop the `npm run dev` process with Ctrl+C.

## Modules and documents

`src/modules/payments`: lifecycle and API; `idempotency`: SHA-256 canonical request fingerprint; `providers`: deterministic simulation; `webhooks`: HMAC and durable event processing; `ledger`: balanced immutable postings and read endpoints; `reconciliation`: report validation, classifier and resolutions. `prisma/schema.prisma` and `prisma/migrations/` specify the relational model. `tests/` contains deterministic unit and PostgreSQL/API tests.

Read subsystem documentation under `docs/`, especially `DECISIONS.md` and `INTERVIEW_GUIDE.md` for trade-offs and detailed technical review questions.

## Explicit limitations

- Cannot claim dependencies, Prisma migration, runtime startup, CI, lint, build, or database tests passed in the authoring environment; no PostgreSQL/Docker/registry DNS access was available.
- Missing generated npm lockfile blocks `npm ci`, Docker build and CI until created on a connected system.
- No live payment provider, settlement banking, refunds, dispute handling, payout engine, cross-currency conversion, financial fee model, FX, accounting period close, or real webhook transport queue.
- Webhook retry relies on signed redelivery (or deterministic recovery on the terminal simulator status); no background worker scans failed webhook rows. Arrival ordering between _different valid terminal outcomes_ is resolved first-committed-wins.
- In-memory per-process throttling is local-dev-only, not distributed protection. API key issuance uses an operator CLI instead of a separate admin IAM service.
- Ledger balancing is checked in application code with an atomic database transaction; PostgreSQL constrains entry amounts, uniqueness, and immutability but does **not** enforce cross-row balancing. A trusted writer bypassing the service could insert unbalanced rows.
- Reconciliation uses exact external transaction identifiers only and assumes the imported report covers the intended period; it has no date-range snapshot boundary or rule for late provider reports. One run per import.
