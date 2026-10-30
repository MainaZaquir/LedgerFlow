# Testing plan and evidence

## Test commands

- `npm run test:unit`: business-rule unit tests (`tests/unit/`).
- `npm run test:integration`: PostgreSQL tests and Supertest API tests (`tests/integration/`, `tests/api/`).
- `npm test`: all Vitest test files.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`: static checks and production compilation.
- `npm run db:generate` then `npm run db:migrate` against a blank database before running integration tests.

Use `DATABASE_URL_TEST=postgresql://ledgerflow:local_dev_only@localhost:5432/ledgerflow_test?schema=public` for PostgreSQL integration tests. The helper refuses to truncate any URL lacking `ledgerflow_test`; cleanup truncates the test database's merchant table with dependent rows and reseeds two unique merchants. CI runs a PostgreSQL 16 service and sets the test connection string.

| Layer                    | Assertions                                                                                                                                                         | What it cannot prove alone                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Unit                     | State transitions, amount limits, fingerprint canonicalization, HMAC verification, double-entry balancing, reconciliation classification, error codes.             | Transaction locks or DB uniqueness.                |
| API + PostgreSQL         | Bearer authentication, merchant scoping, JSON/error contracts, idempotent POST, successful/failed/held payments, cancellation, readiness and OpenAPI availability. | Live provider behavior.                            |
| Concurrency + PostgreSQL | Eight same-key POST requests → one payment/provider operation/posting; simultaneous identical/different webhook events; competing ledger postings.                 | Distributed deployments or provider network races. |
| Failure injection        | Forged signature, invalid event references, ledger mutation triggers, negative DB amounts, deliberate invalid ledger row in transaction → full rollback.           | Arbitrary infrastructure outages or process kills. |
| Reconciliation           | Complete mismatch dataset; duplicate report rows; missing internal/external; incomplete confirmed status; exception resolution and tenant isolation.               | Real external provider report semantics.           |

## Actual verification status

The author's environment had Node 22.16.0, npm 10.9.2, Git, and global TypeScript. `docker` and `psql` were absent; the npm registry hostname was not resolvable. An `npm install --package-lock-only --offline` attempt failed with `ENOTCACHED` for `@prisma/client`. A global TypeScript parser check found **zero source syntax errors** across the initial TypeScript files. **These observations are NOT equivalent to TypeScript typecheck, lint, build, database migration, or passing unit/API/integration tests.** All those checks remain unverified. The `package-lock.json` was not generated for this reason.

## Required follow-through on a connected machine

1. `npm install`, commit `package-lock.json`.
2. `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, fix any failures.
3. Start dedicated PostgreSQL (see README), run migrations against both empty dev and empty test databases, seed dev data.
4. Run `npm run test:unit`, `npm run test:integration`, `npm test`. Investigate all failures instead of suppressing them.
5. Start API, check `/health`, `/ready`, `/docs`, execute `npm run workflow`, inspect ledger and persisted reconciliation runs.
6. Push to GitHub and verify CI passes with PostgreSQL 16; perform a local `docker compose up --build` check.

A passing test suite is **not claimed** in this delivery. Record command output in `BUILD_LOG.md` after actual execution.
