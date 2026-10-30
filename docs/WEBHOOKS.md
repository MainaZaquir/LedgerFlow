# Provider webhooks

Public simulator-only endpoint: `POST /api/v1/webhooks/provider/simulator`. Content-Type `application/json`, body ≤32 KiB. No merchant bearer token: authenticity is supplied by `x-simulator-signature`.

Signature scheme: `sha256=` + lowercase hex HMAC-SHA256 using `SIMULATOR_WEBHOOK_SECRET`, computed over the **exact raw request bytes**. The receiver parses after verifying the signature and compares equal-length digests with `timingSafeEqual`. The secret must have at least 32 characters and is not written into logs or the database.

Payload shape: `{ "eventId": "evt-1", "paymentId": "UUID", "externalId": "sim-UUID", "outcome": "SUCCEEDED" }`. Only `SUCCEEDED` and `FAILED` are accepted. All other fields are forbidden. Only the simulator provider is configured.

## Receipt versus processing

1. Verify signature before parsing JSON or touching the database.
2. Parse and validate identifiers and outcome, create `WebhookEvent(RECEIVED)` with provider-scoped unique event ID.
3. On duplicate event ID, check that content is identical; conflicting reuse returns 409.
4. Within a PostgreSQL transaction: lock event row, recheck terminal processing status, lock payment row, verify matching provider transaction, conditionally transition `PROCESSING` to terminal, update provider state, and (for success) insert balanced ledger transaction + entries.
5. Commit all financial effects and mark event `PROCESSED`, or mark stale events `IGNORED`. Only then return 200.
6. On processing failure, roll back payment/ledger changes; record `FAILED`, increment attempts, and return an error. The **same signed event** can be redelivered and safely retried.

Two different valid terminal outcomes arriving concurrently are serialized on the payment row; the first committed outcome wins. A later contradictory event becomes `IGNORED` and should be investigated by reconciliation. A duplicate event after completion returns the stored `PROCESSED` or `IGNORED` result without another posting.

## Explicit limitations

No scheduled retry worker exists. `FAILED` or `RECEIVED` rows require genuine signed redelivery; this is not an independent durable job queue. No event timestamp window, nonce replay TTL, external provider certificates, or remote provider fetching is implemented. Event identifier uniqueness and terminal state make exact replay harmless, but very large event volumes require retention and partitioning policy. No sensitive payment credentials are accepted. Logging only exposes sanitized failure labels, not full payloads or signatures.
