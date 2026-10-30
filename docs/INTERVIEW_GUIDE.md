# LedgerFlow interview guide

> **Verification caveat:** The repository contains implemented source code and authored tests, but npm, PostgreSQL and Docker execution was not possible in the original authoring environment. Describe the implementation as **written and awaiting full verification**, not as a proven production deployment. Do not claim performance, security certifications, passing tests, or production use that have not been established.

## Two-minute explanation

“LedgerFlow is a simulated payment processing and reconciliation backend built as a TypeScript/Express modular monolith with PostgreSQL and Prisma. The challenge is handling retries and unknown provider outcomes without duplicate financial effects. Merchant API keys are random secrets stored only as hashes; each merchant's data is scoped by the authenticated identity. Payment amounts are integer minor units and the lifecycle is a strict state machine.

A payment creation uses a PostgreSQL transaction and a merchant-scoped advisory lock to insert an idempotency record and a payment atomically. A unique provider-transaction reservation means a client retry does not send the payment again. The simulator can deterministically succeed, fail, delay, or leave a timeout ambiguous. A signed webhook first verifies its HMAC, then persists an event, locks the affected payment, and commits a valid terminal transition and a balanced double-entry posting in the same database transaction. Unique posting references and immutable ledger triggers prevent duplicate or silent rewrite effects through the normal service.

For reconciliation, an imported CSV provider report is validated, matched on exact external transaction IDs, and classified into matches, mismatches, missing/duplicate records and ambiguous outcomes. Exceptions are resolved with auditable notes, not automatic payment edits. I chose a monolith and PostgreSQL instead of distributed infrastructure to make the key invariants clear and transactionally enforceable. I can show you the state machine, SQL constraints, event transaction, and tests for concurrency and rollback. The limitation is that this delivered environment could not execute the PostgreSQL tests, so I would validate those results before asserting measured correctness.”

## Component walkthrough

1. **HTTP boundary:** `src/app.ts` adds Helmet, rate limiting, request IDs, JSON body limits, Swagger and scoped routes. `src/middleware/error.ts` maps safe errors; `src/middleware/auth.ts` resolves merchant identity.
2. **Database:** `prisma/schema.prisma` defines the tables; SQL migration adds native enums, foreign keys, indexes, check constraints and ledger mutation triggers.
3. **Payment creation:** `src/modules/payments/service.ts` acquires an advisory transaction lock and records idempotency with the payment in the same transaction.
4. **Provider simulator:** `src/modules/providers/simulator.ts` reserves one provider transaction per payment. Outcome recovery reads the durable result and never resubmits.
5. **Webhook processing:** `src/modules/webhooks/service.ts` authenticates exact bytes, deduplicates receipts and serializes outcome and ledger effects on PostgreSQL locks.
6. **Ledger:** `src/modules/ledger/service.ts` validates balanced entries and inserts success postings; the SQL migration prevents updates/deletes to history.
7. **Reconciliation:** `src/modules/reconciliation/matcher.ts` defines classification; `service.ts` validates reports, persists a run and audits human resolutions.
8. **Quality:** `tests/unit`, `tests/api`, and `tests/integration` contain rules, API checks, PostgreSQL concurrency, rollback and discrepancy fixtures. Execution is pending a connected environment.

## Key design principles to defend

- The idempotency record controls _logical request identity_; a separate unique provider transaction controls _external operation identity_. Both are needed.
- The simulator's initial `SUCCEEDED`/`FAILED` state is durable before event processing, so `verify` can finish a known outcome without a second provider operation.
- A timeout remains `PROCESSING`; it does not mean declined, failed or reversed.
- Webhook receipt `RECEIVED`, processing `PROCESSED`, stale `IGNORED` and retryable `FAILED` are distinct.
- Terminal states do not mean the merchant has received funds. The ledger records simulated receivable and payable only.
- Reconciliation is an evidence/comparison process, not a payment mutation endpoint.

## Likely technical interview questions and defensible answers

**1. Why TypeScript in strict mode?** It catches implicit `any` and missing assumptions in domain operations, while Zod and database constraints defend runtime boundaries. `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

**2. Why Express?** It keeps routing simple; business rules live in services and can be tested without tying them to controller objects. `src/app.ts` is mainly middleware/routing.

**3. Why a modular monolith instead of microservices?** Payment status and ledger posting need one reliable ACID transaction. Distributed services would add saga coordination without meeting an actual throughput requirement.

**4. How do you store money?** HTTP amounts are bounded positive decimal strings, converted to BigInt and stored as PostgreSQL BIGINT. No floating point or JSON numeric money fields.

**5. How does JPY differ from KES?** The allowed currency set has explicit minor-unit precision: JPY 0, KES 2, USD 2, KWD 3. No calculation assumes every currency uses cents.

**6. What prevents invalid amounts in the database?** SQL `CHECK` constraints protect `Payment`, `ProviderReportRow` and `LedgerEntry` even if a caller bypasses HTTP validation.

**7. How does merchant authentication work?** An operator issues a 256-bit random key; only its SHA-256 digest is persisted. Requests send `Authorization: Bearer lf_test_...`; the middleware hashes it and resolves `merchantId`.

**8. Why hash API keys with SHA-256 instead of bcrypt?** They are cryptographically random high-entropy secrets, unlike user-chosen passwords. Fast digests permit indexed lookup; entropy, transport controls and revocation are important.

**9. How is tenant isolation enforced?** Merchant routes apply a `merchantId` Prisma filter to their primary queries, while reconciliation resolution checks the item's parent run. Other merchants see a 404 for inaccessible IDs.

**10. What is an idempotency key?** A merchant-scoped client-generated identifier for one logical create operation. Repeating it with equivalent normalized payload returns the same payment ID; reusing it with different data yields a 409.

**11. How do you compare equivalent JSON payloads?** Zod parses/defaults first, then a canonical recursive sorter serializes object keys before SHA-256 hashing, so property order is irrelevant.

**12. Why is a check-then-insert insufficient?** Two requests can both see no record and each create a payment. An advisory transaction lock serializes the key path and a database unique index is the final guard.

**13. What exactly is persisted for replay?** The idempotency row stores merchant, operation, key, fingerprint, payment ID, initial logical status code and timestamp. The endpoint replies with the current payment representation, not the original byte-for-byte response.

**14. What happens when the client times out after payment creation?** It repeats the same key. LedgerFlow reads the existing payment rather than creating or resubmitting a new provider operation.

**15. What are valid payment transitions?** `PENDING → PROCESSING|CANCELLED` and `PROCESSING → SUCCEEDED|FAILED`; all terminal statuses have no outgoing transitions. The rules are in `payments/state.ts`.

**16. Why is `PROCESSING` cancellation rejected?** Because a provider may already have accepted a charge. Local cancellation without verified provider cancellation could create a contradictory record.

**17. How are provider timeouts simulated?** `timeout` leaves a durable provider transaction with status `UNKNOWN`; `timeout-after-accept` leaves `ACCEPTED`. Both keep the payment `PROCESSING`, with no automatic resubmission.

**18. What does `/verify` do?** It reads the recorded provider transaction for a merchant's payment and processes a known terminal `SUCCEEDED`/`FAILED` result through the common event handler. It never initiates another provider operation.

**19. How do you authenticate a webhook?** Verify `sha256=` HMAC-SHA256 over the exact raw payload with the simulator secret, using timing-safe comparison after length checking, then parse JSON.

**20. How do duplicate webhooks avoid duplicate postings?** Unique provider/event ID, event-row lock, payment-row lock, terminal state check and ledger posting uniqueness. The status transition and ledger write are one transaction.

**21. What if two events report opposite terminal outcomes?** PostgreSQL locks serialize them. The first event to commit a terminal state wins; the later event is recorded as `IGNORED`. Reconciliation is responsible for investigating discrepancies.

**22. Why store webhook receipt separately from processing?** To track the difference between authenticated receipt and committed effects, prevent mistaken 200 acknowledgements, and allow failed processing to be retried by signed redelivery.

**23. What does a successful payment post?** Debit `PROVIDER_CLEARING` and credit `MERCHANT_PAYABLE` for equal integer minor-unit amounts. This records a provider receivable and merchant liability, not actual cash settlement.

**24. What makes a ledger transaction balanced?** At least two positive entries in a single currency, with total debits equal to total credits. `assertBalanced` checks before the posting transaction inserts them.

**25. Can the database alone guarantee balance?** No. It enforces positive amounts, account names, posting uniqueness and immutability. Cross-row balancing relies on the trusted posting service within a transaction, which is a deliberate limitation.

**26. How do you avoid a partially written ledger?** Both entries and their parent are created within the same Prisma transaction that changes payment status. A failure rolls back all writes; failure-injection tests deliberately violate an entry constraint.

**27. Can ledger entries be edited?** Normal API only exposes GETs. Database `BEFORE UPDATE/DELETE` triggers forbid changes to posted ledger entries and parent records. A privileged insert bypass is still possible, so DB permissions should be hardened.

**28. How does reconciliation match records?** Exact `provider_transaction_id` only. Duplicate external IDs take precedence, followed by missing internal, currency mismatch, amount mismatch, unconfirmed/ambiguous status, status mismatch, then match.

**29. Why not automatically fix differences?** Imported reports can be incomplete or wrong. Changes to money and ledger must follow separate approved adjustment workflows. Reconciliation records auditable human resolutions only.

**30. How do you test actual concurrency?** Supertest launches multiple requests concurrently against PostgreSQL, then checks there is one payment, provider transaction and posting. Other tests deliver duplicate or competing signed events and race duplicate ledger writes.

**31. How does the API handle errors safely?** `AppError` maps known domain errors to consistent JSON code/message/request ID. Malformed JSON and body-too-large receive 400/413. Unknown errors return generic 500 without stack traces.

**32. What does readiness mean?** `/ready` issues a `SELECT 1` against PostgreSQL; it reports 503 when that dependency is unavailable. `/health` just confirms the HTTP process can respond.

**33. How is the simulator different from a real adapter?** It durably records deterministic states in the same database and can synthesize signed provider events. A production adapter would use external credentials, stable provider operation keys, transport retries with status queries, asynchronous confirmation and sandbox contract tests.

**34. What is missing before deployment?** Full dependency resolution and actual test evidence, lockfile, CI execution, safe provider dispatch recovery, background webhook worker, settlement/refunds, stronger tenant DB boundaries, distributed abuse controls, key rotation, telemetry, and formal operational security.

## Ten challenging follow-up questions

**F1. A process crashes after inserting a payment but before reserving the provider transaction. Will a retry complete it?** No. The retry returns the stable `PENDING` record and does not dispatch again. This avoids accidental duplicate submissions but needs an operator-controlled outbox/dispatch recovery mechanism, which is not implemented.

**F2. A process crashes after the simulator recorded `SUCCEEDED` but before the webhook completed. Can it recover?** Yes, `/verify` reads terminal simulator state and runs the same inbox/ledger path. It cannot invent a terminal outcome from `UNKNOWN` or `ACCEPTED`.

**F3. Two different idempotency keys submit the same logical invoice. Is double payment prevented?** No. Idempotency is per provided key, not per merchant order/reference. Production would enforce a unique merchant business reference and its own duplicate-detection policy.

**F4. Could advisory-lock hash collisions cause wrong payment reuse?** Hash collisions can serialize unrelated keys, but cannot conflate their rows because the unique key includes the original textual merchant, operation and idempotency key.

**F5. A webhook includes a valid signature but references another merchant's payment. Is it accepted?** The event must match the specific payment's reserved provider transaction and external ID. However, the simulator uses a single global signing secret and does not independently bind the incoming event to a merchant-specific credential. Production providers need stronger per-account identity binding.

**F6. What if the same provider event ID is resent with a different outcome?** The event's existing `paymentId`, `externalId` and `outcome` are compared; conflicting reuse returns 409. Exactly matching duplicates are safe to reprocess or acknowledge.

**F7. Does ledger immutability mean arbitrary privileged SQL cannot alter finances?** No. It blocks UPDATE/DELETE but not extra INSERT statements or superuser trigger bypass. Production needs restricted roles and ideally a deferred balance-enforcing trigger or trusted database posting function.

**F8. What if the provider report is only a partial day's file?** The current matcher may classify other internal transactions as `MISSING_PROVIDER`. A production engine must know the report period/watermark, settlement cycles and whether the report is complete.

**F9. Can you refund a successful payment?** Not in this implementation. Reversing status or editing historical entries would be incorrect. Add a separate refund entity, provider operation and balanced compensating ledger transactions tied to the original payment.

**F10. What does a green test suite prove?** Once actually run, it supports the behavior of tested cases on that PostgreSQL version and process topology. It does not prove distributed correctness, regulatory compliance, security under attack, disaster recovery, or real-provider compatibility. At delivery time tests were written but had **not been run**.

## Suggested reviewer inspection route

Start with `payments/service.ts` and its transaction/lock, then `providers/simulator.ts`, `webhooks/service.ts`, `ledger/service.ts` and migration SQL, and finally `reconciliation/matcher.ts` and `reconciliation/service.ts`. Compare each critical claim against the corresponding test under `tests/`. Run PostgreSQL tests before describing the behavior as verified.
