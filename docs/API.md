# API contract

OpenAPI 3.0 specification is served from `GET /openapi.json`, with Swagger UI at `/docs`. The authoritative routing code is `src/app.ts` and the module `routes.ts` files. All merchant-protected endpoints use `Authorization: Bearer lf_test_<base64url>` and return `404` for another merchant's resource. The simulator webhook uses a raw-body HMAC header instead of a merchant bearer key.

## Successful responses

Create a payment with `POST /api/v1/payments`, header `Idempotency-Key: invoice-2026-001`, and body:

```json
{
  "amount": "2500",
  "currency": "KES",
  "scenario": "success",
  "description": "demo invoice"
}
```

A successful result is HTTP 201 with the shape:

```json
{
  "data": {
    "id": "<uuid>",
    "amount": "2500",
    "currency": "KES",
    "status": "SUCCEEDED",
    "description": "demo invoice",
    "providerTransactionId": "sim-<uuid>",
    "createdAt": "<ISO8601>",
    "updatedAt": "<ISO8601>"
  }
}
```

The ID and timestamps above are **placeholders, not output observed from a running server**. The same key+equivalent parsed input returns HTTP 201 and the **same payment ID** but may show a newer status. Another payload with that key returns 409. `GET /api/v1/payments?page=1&limit=20` returns `{data:[...],pagination:{page,limit,hasMore}}`. Limit range 1–100 and page range 1–10,000. `GET /api/v1/payments/:id` returns the same single payment shape.

`POST /api/v1/payments/:id/cancel` is allowed only for `PENDING` payments (demonstrate with `scenario:"hold"`), otherwise 409. `POST /api/v1/payments/:id/verify` checks for a known terminal provider status, without resubmission.

## Webhook

`POST /api/v1/webhooks/provider/simulator` accepts exact JSON raw body and `x-simulator-signature: sha256=<64 lowercase hexadecimal characters>`. Required event fields: `eventId`, UUID `paymentId`, `externalId`, and outcome `SUCCEEDED|FAILED`. On successful processing or an ignored stale event: HTTP 200 `{data:{status:"PROCESSED"}}` or `{data:{status:"IGNORED"}}`. Signature failure: 401. Invalid body/reference: 400. Conflicting reused event ID: 409. Authenticated receipt can persist a `FAILED` row for later redelivery when business processing fails.

## Ledger

`GET /api/v1/ledger/transactions` is paginated and `GET /api/v1/ledger/transactions/:id` returns one merchant-owned transaction with `entries` including account, `DEBIT|CREDIT`, string amount, and currency. No mutation endpoints are exposed.

## Reconciliation

`POST /api/v1/reconciliation/imports` requires `{provider:"simulator",filename:"report.csv",csv:"provider_transaction_id,amount,currency,status,timestamp\n..."}`. HTTP 201 returns import ID, filename, provider, timestamp and row count. CSV has 1–1000 validated rows and ≤100,000 characters. Allowed report statuses are `UNKNOWN`, `ACCEPTED`, `SUCCEEDED` and `FAILED`.

`POST /api/v1/reconciliation/runs` takes `{importId:"<uuid>"}` and returns run ID. It is unique per merchant/import; a duplicate run returns 409. `GET /api/v1/reconciliation/runs/:id` returns run metadata and classified items. `GET /api/v1/reconciliation/exceptions?page=1&limit=20&unresolved=true` lists non-matches. `POST /api/v1/reconciliation/exceptions/:id/resolve` takes a five-to-500-character `resolution` note and returns updated item; re-resolution is a 409.

## Error contract

For known client errors:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Idempotency key reused with a different request",
    "requestId": "<correlation-id>"
  }
}
```

The correlation ID comes from a safe `x-request-id` header value or a generated UUID. Other errors include `VALIDATION_ERROR`, `BAD_JSON`, `IDEMPOTENCY_KEY_REQUIRED`, `UNAUTHORIZED`, `NOT_FOUND` and `PAYLOAD_TOO_LARGE`. Unexpected exceptions are mapped to `500 INTERNAL_ERROR` with a generic message and no stack trace. Health `/health` is liveness only; `/ready` queries PostgreSQL and returns 503 when unavailable.

**Specification limitations:** The OpenAPI document is manually maintained (not generated from Zod), so route-schema drift remains possible. It covers the implemented paths, request structures, errors and auth mode, but some successful collection result schemas are described rather than fully normalized into reusable OpenAPI components. Review the route inventory and add contract tests before production exposure.
