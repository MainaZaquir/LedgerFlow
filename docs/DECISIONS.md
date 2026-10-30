# Architecture decisions

## ADR-001: Single service and one PostgreSQL store

**Context:** The payment state and ledger entry must commit together. **Decision:** Express modular monolith with Prisma/PostgreSQL transactions. **Alternative:** Microservices with distributed queues. **Trade-off:** Simple atomicity and reviewability versus horizontal isolation and independent scaling.

## ADR-002: Integer minor units, decimal JSON strings

**Context:** JavaScript numbers are unsuitable for money and not all currencies have two decimal places. **Decision:** PostgreSQL `BIGINT`; BigInt in TypeScript; validated decimal strings at the HTTP boundary and four explicit currency precision rules. **Alternative:** Decimal math and amount strings with scale. **Trade-off:** Small, exact and easy to test but lacks FX and arbitrary precision and requires explicit currency knowledge.

## ADR-003: Durable merchant-scoped idempotency

**Context:** Client retries and overlapping POST requests can create duplicates. **Decision:** Unique merchant/operation/key, canonical fingerprint, transaction-scoped advisory lock, one logical payment ID, only new record invokes simulator. **Alternative:** Redis lock or memory map. **Trade-off:** Correctness relies on PostgreSQL and provider operation reservation; a crash after initial commit can leave a `PENDING` record requiring recovery.

## ADR-004: Provider reservation precedes outcome

**Context:** Unknown external outcomes must not be resent blindly. **Decision:** One-to-one provider transaction, durable status `UNKNOWN|ACCEPTED|SUCCEEDED|FAILED`, `verify` never re-submits. **Alternative:** Treat timeouts as failure and retry. **Trade-off:** Conservative unknown states require manual event/operational remediation.

## ADR-005: Signed webhook inbox with synchronous processing

**Context:** Need exact-once business effects despite duplicate signed events. **Decision:** HMAC raw bytes, persist inbox receipt, lock event and payment, atomic payment+ledger commit; failed inbox row supports redelivery. **Alternative:** External task queue. **Trade-off:** Simplicity with no automatic backoff worker; large workloads would require a durable worker/outbox.

## ADR-006: First terminal outcome wins

**Context:** Different signed events can contradict each other or arrive out of order. **Decision:** Terminal payment states immutable; later events ignored, discrepancy surfaced for investigation. **Alternative:** Trust provider timestamps. **Trade-off:** Cannot automatically correct a genuinely wrong first event; requires a correction process outside this demo.

## ADR-007: Minimal two-account ledger

**Context:** Demonstrate exact double-entry without pretending full payment settlement. **Decision:** debit provider clearing, credit merchant payable, two entries per success, unique posting key, immutable history. **Alternative:** Full general ledger. **Trade-off:** No fees, payouts, refunds, or compensating transaction API. Balance is enforced in trusted service, not by a PostgreSQL deferred trigger.

## ADR-008: Exact identifier reconciliation

**Context:** Fuzzy matching risks incorrect cash/accounting changes. **Decision:** Compare imported provider report rows to internal provider transaction IDs and classify discrepancies; resolutions only annotate. **Alternative:** Time/amount heuristics with automatic fixes. **Trade-off:** More exceptions and incomplete-period false positives, but no silent financial modifications.

## ADR-009: Operator CLI keys and in-process throttle

**Context:** A portfolio demo needs an auth boundary without enterprise IAM. **Decision:** 256-bit random keys stored as SHA-256 digests, operator CLI issuance, per-process limiter. **Alternative:** OAuth+OIDC or separate auth server. **Trade-off:** No rotation API, distributed quota, or device authorization; not appropriate for a production merchant onboarding service.

## ADR-010: Explicit verification status

**Context:** Required npm/PostgreSQL dependencies are unavailable in the authoring container. **Decision:** Deliver source, SQL migration, authored tests, Docker and CI configuration, log environment limitations, and refrain from unsubstantiated passing claims. **Alternative:** Fabricate lockfile/test results. **Trade-off:** Deliverable does not meet all acceptance criteria until executed on a connected machine.
