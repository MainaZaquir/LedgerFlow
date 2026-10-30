# Reconciliation

The import route accepts a JSON body containing `provider: "simulator"`, `filename` ending `.csv`, and `csv` as a UTF-8 text string. Maximum CSV size 100,000 characters and 1,000 records; header and column ordering are exact:

```csv
provider_transaction_id,amount,currency,status,timestamp
sim-uuid-here,2500,KES,SUCCEEDED,2026-10-29T10:00:00.000Z
```

Amounts are positive integer minor-unit strings, currencies KES/USD/JPY/KWD, provider status `UNKNOWN|ACCEPTED|SUCCEEDED|FAILED`, and timestamp must have a timezone offset. Missing columns, extra columns, malformed rows, unsupported currencies, and unreasonable amounts are rejected before persistence. Imported records may repeat an external ID intentionally so the run identifies a provider report duplicate rather than silently dropping it.

## Matching algorithm

Given a selected import, load all internal `ProviderTransaction` rows scoped to the authenticated merchant and matching provider, including their related payment lifecycle status. A payment still `PROCESSING` is classified as unconfirmed even if the simulator durably recorded a terminal provider result but ledger posting has not completed. Match **only by exact provider external transaction ID**. No fuzzy match by amount, date or merchant description.

1. If multiple report rows use the same external ID, mark each `DUPLICATE_PROVIDER`.
2. If the report ID does not exist internally, mark `MISSING_INTERNAL`.
3. For exactly one matching ID, precedence is currency mismatch, amount mismatch, unconfirmed internal payment status (mapped to `UNKNOWN`/`ACCEPTED` => `AMBIGUOUS`), then status mismatch; otherwise `MATCHED`.
4. Internal provider transactions with no report occurrence are marked `MISSING_PROVIDER`.

One `ReconciliationRun` per merchant/import is stored with durable `ReconciliationItem` rows and an audit log. `GET /runs/:id` shows all items; `GET /exceptions?unresolved=true` paginates non-matches. Authorized `POST /exceptions/:id/resolve` saves a human note/timestamp and an audit log atomically; it does not alter payments, provider transactions, or ledger postings. A second resolution returns 409.

## Limitations and trade-offs

A snapshot import has no report period or completeness watermark. All merchant provider transactions currently participate, so an incomplete report can produce legitimate `MISSING_PROVIDER` exceptions. There is no fuzzy matching, status translation for external processors, multirecord split/merge settlement support, currency conversion, fee deduction, or automatic remediation. `AMBIGUOUS` is specifically used for a known but unconfirmed internal provider status. A completed run is immutable as a classification snapshot except for auditable resolution notes.

Example: `samples/provider-report.csv` contains a placeholder, an unmatched external ID, and duplicate IDs. `npm run workflow` builds an exact-match row using an actual generated payment ID plus one unmatched record and creates an inspectable run.

**Tests:** complete classification fixture, malformed report rejection, duplicate run conflict, tenant isolation, idempotent resolution, and preservation of original payment amount. Requires PostgreSQL to execute.
