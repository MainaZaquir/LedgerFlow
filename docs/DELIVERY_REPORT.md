# LedgerFlow delivery and acceptance report

**Date:** 2026-10-29
**Git commit:** `54476d3` (initial source implementation; this report is in a follow-up commit).
**Status:** **Implementation authored; full acceptance blocked by the environment. NOT production-verified.**

## 1. Built

TypeScript/Node 22 Express modular monolith with Prisma/PostgreSQL relational schema and initial SQL migration; validated config, structured logging, safe errors, Helmet and throttling; merchant API-key issuance and SHA-256 storage; payment lifecycle with unique provider reservations and merchant-scoped PostgreSQL advisory idempotency lock; deterministic simulator including success, failure, hold, processing and ambiguous timeouts; raw-body HMAC webhook receipt, event deduplication, row-lock-serialized terminal outcomes and transactionally atomic ledger posting; immutable two-account double-entry ledger, ledger read endpoints; CSV import, reconciliation classification, persisted exception resolution and audit log; OpenAPI/Swagger; Docker/Compose and PostgreSQL CI workflow; Vitest/Supertest test files; 13 required design/test/interview documents plus this delivery report.

## 2. How to run (requires network-enabled Node/Docker host)

```bash
cp .env.example .env             # change the webhook signing secret
npm install                      # generate package-lock.json, then commit it
npm run db:generate
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run db:key -- demo-one
npm run dev                       # listens on http://localhost:3000
```

`GET /health`, `GET /ready`, `GET /openapi.json` and Swagger UI `/docs`. Run `npm run workflow` for an automated payment → signed event → reconciliation demonstration. **These commands are instructions and have not been executed to completion in the original environment.**

## 3. Actually executed checks

| Check                                         | Result                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Node runtime inspection                       | PASS, Node `v22.16.0`, npm `10.9.2`                                                         |
| Git repository initial commit                 | PASS, `54476d3`                                                                             |
| TypeScript source syntax parse                | PASS, 35 source/test/script/config TS files parsed without syntax diagnostics at last check |
| Pure rule execution                           | PASS, 10 Node assertions running transpiled actual domain modules                           |
| JSON configuration parse                      | PASS for `package.json`, TypeScript configs and Prettier config                             |
| Prisma model ↔ SQL table inventory           | PASS, all 13 Prisma model names have SQL CREATE TABLE                                       |
| `npm install --package-lock-only --offline`   | FAIL `ENOTCACHED` for `@prisma/client`                                                      |
| `tsc --noEmit`                                | FAIL `TS2688`, `@types/node` unavailable                                                    |
| `npm ci`, Prisma CLI generate/migrate         | BLOCKED, npm registry DNS and missing packages/lockfile                                     |
| Lint/Prettier/build                           | BLOCKED, missing npm dependencies (not passed)                                              |
| Vitest unit/API/integration/concurrency tests | BLOCKED, npm packages and PostgreSQL absent (not passed)                                    |
| Container boot/CI execution                   | BLOCKED, Docker absent / CI not invoked                                                     |

## 4. Important authored tests

- `tests/api/payments.test.ts`: same-key concurrency with eight calls, payload conflicts, two-merchant isolation, ambiguous timeout, hold/cancel, successful ledger posting, validation.
- `tests/integration/webhooks-ledger.test.ts`: valid/invalid signatures, deduplication, concurrent terminal events, stale events, immutable DB triggers, rollback after invalid row and competing postings.
- `tests/integration/reconciliation.test.ts`: all eight reconciliation classifications in one realistic fixture, persisted resolution, duplicate imports/runs and tenant isolation.
- `tests/unit`: state rules, amount constraints, canonical fingerprints, balancing, HMAC and matching logic.

**These are test definitions, not recorded passing Vitest results.**

## 5. Repository inspection

- Source: `src/modules/{payments,idempotency,providers,webhooks,ledger,reconciliation}`
- Schema and migration: `prisma/schema.prisma`, `prisma/migrations/20261029000000_init/migration.sql`
- Routes/app: `src/app.ts`, `src/openapi.ts`
- Automation: `docker-compose.yml`, `Dockerfile`, `.github/workflows/ci.yml`
- Sample: `samples/provider-report.csv`, `scripts/demo-workflow.ts`
- Technical decisions and interviews: `docs/DECISIONS.md`, `docs/INTERVIEW_GUIDE.md`

## 6. Major trade-offs

ACID transactions instead of distributed microservices; integer minor units rather than floating money; stable logical replay rather than exact HTTP byte replay; one durable operation per provider payment; first committed terminal event wins; ledger balance checked in service but not by database cross-row aggregate; exact external-ID matching rather than guessed fuzzy matches. See decision records and subsystem documentation.

## 7. Known limitations and blockers

**Acceptance blockers:** no lockfile due offline npm registry, no successful dependency installation, no runtime PostgreSQL, no migration execution, no passing test suite evidence, no completed build/lint/format checks, no live server verification, no CI run. Do not present LedgerFlow as a finished, verified production-grade service yet.

**Designed limitations:** no live payment networks, no outbox-driven automatic dispatch, no scheduled webhook worker, no refund or compensating posting API, no payout/settlement logic, no database-level deferred balancing rule, no RLS/composite FKs for every tenant link, no shared edge abuse control or payment-compliance certification. These are documented, not hidden.

## 8. Next verification steps

Run `npm install`, commit `package-lock.json`, apply migrations on a clean PostgreSQL database, execute typecheck/lint/Prettier/build, then run unit/integration/API/concurrency tests. Fix anything they reveal; follow with local startup, Swagger contract and demo workflow verification, Docker build and GitHub Actions. Finally update the evidence in `docs/BUILD_LOG.md` with actual output, not estimates.

## 2026-10-30: verified local PostgreSQL acceptance checkpoint

**Verified by the project owner on macOS Monterey:** Prisma client generation and migration deployment; successful application startup; 19/19 PostgreSQL integration/API tests; repeat full-suite result of 26/26 passing; typecheck, ESLint, Prettier and production TypeScript build passing; successful simulated payment/webhook/reconciliation demonstration; one exposed demo API key revoked; production dependency audit reporting zero vulnerabilities after controlled upgrades/overrides.

**Caveats:** An intermittent reconciliation test failure (`401` rather than `409`) was not reproduced on rerun and should not be presumed fixed. `deepmerge-ts@8.0.1` is an upstream-version override and was tested only through the observed project checks. Developer-inclusive audit results and GitHub Actions execution have not been verified. The simulated platform is not certified, regulated or production-ready merely because these checks passed. See `docs/BUILD_LOG.md` for details.
