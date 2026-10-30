# Build log (evidence-based)

**2026-10-29, authoring environment**

| Stage                            | Implemented                                                                                               | Verification actually performed                                                      | Outstanding                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 0 environment                    | Empty workspace established; Node/npm/Git inspected                                                       | `node -v`: `v22.16.0`; `npm -v`: `10.9.2`; Docker/psql absent. npm DNS inaccessible. | Install Docker/PostgreSQL and access npm registry.                                      |
| 1 foundation                     | TypeScript strict config, Express app, error middleware, structured logs, Swagger, Docker Compose, CI     | Source files written; TypeScript parser syntax check initially reported zero errors. | Dependency installation, runtime boot, typecheck, lint, format, build.                  |
| 2 schema/auth                    | Prisma schema, explicit SQL migration, deterministic merchant seed, hashed API keys, auth                 | Files written and manually compared for core columns.                                | Apply migration to real PostgreSQL; Prisma generate; auth integration tests.            |
| 3-5 payment/idempotency/provider | State machine, merchant locks, stable fingerprints, durable provider reservation, deterministic scenarios | Files authored; no HTTP or PostgreSQL test run.                                      | Execute API and PostgreSQL concurrency tests; verify recovered timeout paths.           |
| 6-7 webhook/ledger               | HMAC, durable inbox, duplicate protection, atomic balanced postings and DB immutability triggers          | Files and tests authored.                                                            | Execute signed delivery and rollback tests; inspect transaction behavior on PostgreSQL. |
| 8 reconciliation                 | Validated CSV parser, matching engine, persistence and audited resolutions                                | Files, realistic unit/integration fixtures authored.                                 | Execute end-to-end reconciliation and malformed-CSV tests.                              |
| 9-10 docs/handoff                | README, module docs, ADRs, interview guide, scripts, CI                                                   | Static source review; no runtime tests.                                              | Run all acceptance checks on a compatible system.                                       |

**Observed installation blocker:** `npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund` failed with `ENOTCACHED` because `@prisma/client` was not in npm cache. `curl` failed DNS resolution for `registry.npmjs.org`. No lockfile could be generated; `npm ci` and Docker build cannot yet succeed. No simulated pass counts are recorded.

The delivery is a **source implementation with authored tests, not a verified working production system**. See `docs/TESTING.md` for the exact remaining commands.

**Additional executed static verification:** After source revisions, a global TypeScript parser check parsed 35 TypeScript files with zero syntax diagnostics. A dependency-free Node 22 script transpiled the actual pure business-rule modules using global TypeScript and executed **10 assertions successfully** (state transitions, canonical fingerprints, ledger balancing/rejection, reconciliation classifications). This is **not** a Vitest run and does not verify Prisma, HTTP, migrations, or concurrency. `tsc --noEmit` was attempted and failed immediately with `TS2688` because `@types/node` cannot be installed.

## 2026-10-30: verified local PostgreSQL acceptance checkpoint

The project owner provided actual Terminal outputs from macOS 12.7.6 with local PostgreSQL (no Docker). These observations supersede the earlier authoring-environment blockers where applicable:

- Prisma Client `6.19.3` generated; `20261029000000_init` applied to the development and test PostgreSQL databases; a subsequent migration deploy reported **no pending migrations**.
- Merchant seed and local API-key issuance succeeded; server emitted `LedgerFlow started` on port 3000.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run format:check` completed without errors after fixes and formatting.
- `npm run test:integration`: **19/19 passed** against PostgreSQL; later `npm test`: **26/26 passed across five test files** on multiple executions.
- `npm run workflow` completed; generated a payment identifier, received webhook `PROCESSED`, and created a reconciliation run and import identifier. The console output does not independently show every ledger entry; posting behavior is covered by the integration tests.
- Explicitly revoked **one active demo-one API key** after its disclosure in chat.
- Upgraded Express to `4.22.3`, csv-parse to `7.0.3`, Zod to `4.6.7`, and Prisma/client to `6.19.3`; configured overrides for body-parser, qs, and `deepmerge-ts@8.0.1`. After changes, production audit `npm audit --omit=dev` reported **0 vulnerabilities**.
- One intermittent reconciliation test returned `401` instead of expected `409` on a repeated resolution request. The test passed alone (2/2) and the full suite passed on subsequent runs (26/26). Root cause has **not** been established; test isolation and potential shared data cleanup remain review items.

**Not yet verified from provided evidence:** GitHub Actions execution, Docker container build/start, clean `npm ci` verification, developer-inclusive `npm audit`, repeatability under prolonged/stress runs, production deployment or security assessment. The Prisma configuration warning remains deprecation guidance, not a migration failure. `deepmerge-ts@8.0.1` is an override outside Prisma's declared dependency range; retain this as a documented compatibility risk even with passing local tests.
