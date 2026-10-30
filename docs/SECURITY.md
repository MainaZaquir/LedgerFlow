# Security model and threat review

## Scope

Simulated funds only. No card numbers, banking credentials, customer PII, live merchant funds, real settlement, or regulatory certification. This project makes no PCI DSS, SOC 2, AML, or other certification claim.

## Assets and trust boundaries

- **Merchant secrets:** 32 random bytes from `crypto.randomBytes`, base64url encoded with `lf_test_` prefix. Only SHA-256 digest is persisted in `ApiKey.hash`. Operator `db:key` prints the plaintext secret **one time**. Revocation is an explicit nullable DB timestamp, not a user-facing route. High-entropy API keys are suitable for fast SHA-256 hashing; passwords would require a slow password KDF.
- **Provider webhook secret:** Config validated for at least 32 characters. HMAC-SHA256 on raw bytes, constant-time comparison after length check, signature required before payload parse. No real provider credential.
- **Tenant boundaries:** Every payment, ledger, reconciliation import/run/exception endpoint scopes reads/writes to `req.merchantId` from a valid API key. Cross-merchant records are returned as HTTP 404. Provider callbacks are associated with a registered provider transaction and payment ID.
- **Financial integrity:** Positive bounded `BIGINT` minor units; DB checks, unique constraints, conditional state transitions, row locks, atomic ledger posting, mutation-denial triggers. Idempotency uses DB advisory locks rather than in-memory flags.
- **Inputs:** Zod object `.strict()` for write payloads; exact supported currencies/statuses; bounded page/limit; CSV parse max record size, 1,000 rows, 100,000 characters; JSON body 128 KiB, raw webhook body 32 KiB.
- **API hardening:** Helmet response headers; in-memory IP throttle 120 requests/minute; disabled Express `x-powered-by`; request correlation ID; consistent safe errors; structured Pino logging with redaction and no request-body auto logging.
- **Operational state:** Validated environment variables at startup; `.env` ignored by Git; local placeholders only. Readiness tests database connectivity without returning DSNs or secrets.

## Threat scenarios

| Threat                             | Current mitigation / limitation                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guessing API keys                  | High-entropy random tokens, SHA-256 lookup, throttling. No brute-force-resistant distributed gateway or dynamic lockout.                                    |
| Key leak                           | Logs redact `authorization`; revocation timestamp available via DB. CLI prints key once; operator is responsible for safe handling.                         |
| Cross-merchant reads               | Merchant-scoped Prisma filters and tests with two merchants. Database does not implement RLS.                                                               |
| Forged provider event              | HMAC verify before JSON parse, exact raw body and constant-time equality. Simulator secret compromise would defeat authenticity.                            |
| Event replay                       | Provider/event ID uniqueness; processing locks; terminal payment state; ledger posting key uniqueness.                                                      |
| Invalid or enormous input          | Zod and parser size/count limits; file uploads not supported.                                                                                               |
| Crash between payment and provider | Durable idempotency prevents a second payment; missing outbox worker requires operator recovery.                                                            |
| Direct database writes             | Only app-role behavior is tested in design; DB triggers prevent ledger updates/deletes, but DB grants and deferred balance constraints are not implemented. |
| Denial of service                  | In-process limiter, body caps and indexed queries; no shared/edge limiter or resource-based quotas.                                                         |
| Reconciliation misinformation      | Never automatically adjusts payments/ledger; exception review is audited. Signed/attested provider report authenticity is out of scope.                     |

## Improvements before production

TLS termination and key management, secret rotation, separate service identities, encrypted sensitive backups, database role restrictions, RLS/composite tenant FKs, multi-instance rate limiting, durable outbox/inbox workers, terminal-state reconciliation procedures, clock skew policy, webhook replay windows, security event monitoring, comprehensive audit trail, ledger balancing constraint in the database, data lifecycle and recovery drills, load/concurrency benchmarks, and independent security review.

Review tests in `tests/api/payments.test.ts` and `tests/integration/webhooks-ledger.test.ts`. They are authored but have not run in the delivered authoring environment.
