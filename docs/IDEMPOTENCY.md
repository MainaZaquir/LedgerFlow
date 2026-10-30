# Idempotency

`POST /api/v1/payments` requires `Idempotency-Key`, 8-128 characters matching `[A-Za-z0-9._:-]`. Key scope: `(merchantId, 'payments:create', key)` with a unique PostgreSQL constraint.

## Request normalization and replay

Zod validates and defaults the request (including the simulator scenario). A SHA-256 fingerprint over recursively key-sorted canonical JSON checks payload equivalence. `amount` must be a decimal integer string. The transaction creates a payment and a unique idempotency record as one unit and stores its `paymentId` and logical success code (201).

Replay with an equal fingerprint yields 201 and **the current representation of the original payment** (same ID; state may have progressed). Replay with a different fingerprint returns 409. Two merchants can reuse the same textual key without collision. We do not store and replay a byte-for-byte HTTP response; the stable logical payment ID is the replay contract.

## Concurrent requests

`SELECT pg_advisory_xact_lock(hashtextextended(merchantId + operation + key, 0))` inside a PostgreSQL transaction serializes competing request reservations. A unique `(merchantId, operation, key)` index is the final guard. After transaction commit, **only the request that inserted the record** calls the provider simulator. The provider operation itself is unique by payment ID. Advisory hashes can collide, which can unnecessarily serialize unrelated requests but must not produce duplicate payment creation.

## Failures and retention

If the initial DB transaction rolls back, neither payment nor idempotency record exists, and a retry is safe. If it commits but execution fails afterward, replay returns the existing payment without starting another provider operation. A partial `PENDING` state requires an operator-controlled dispatch recovery mechanism that is **not implemented**. If provider state is `UNKNOWN`/`ACCEPTED`, automatic resubmission is prohibited. `verify` can consume only a terminal recorded provider status. Reconciliation may surface unresolved outcomes.

Idempotency records currently have **no automatic expiration**. This is deliberately conservative: reuse of an old key is always rejected if the payload changes and cannot double-submit. At scale, define a documented retention interval and archive or tombstone keys rather than simply deleting them. The `createdAt` index supports that future work.

**Review test cases:** concurrent same-key requests, same key with changed amount, merchant isolation, provider-timeout replay, and one `ProviderTransaction`/ledger posting. PostgreSQL integration tests exist but remain unexecuted until the database environment is available.
