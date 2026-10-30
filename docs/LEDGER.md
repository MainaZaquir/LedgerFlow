# Double-entry ledger

**Simplified accounting assumption:** On a confirmed successful charge of 2,500 KES minor units, LedgerFlow recognizes a receivable from the simulated provider and a liability to the merchant. It does **not** claim provider settlement, cash receipt, fees, payout, or bank reconciliation occurred.

| Account | Debit | Credit |
| --- | ---: | ---: |
| `PROVIDER_CLEARING` (receivable) | 2500 | 0 |
| `MERCHANT_PAYABLE` (liability) | 0 | 2500 |
| **Totals** | **2500** | **2500** |

A ledger transaction has a unique `PAYMENT:<paymentId>:SUCCESS` posting key and a unique `paymentId`. Entries have positive `BIGINT` amounts and explicit matching currency. Posting is permitted only as part of the database transaction that changes a payment from `PROCESSING` to `SUCCEEDED`. Failed, cancelled, pending and processing payments have no successful-payment posting.

`assertBalanced` rejects postings with fewer than two entries, zero/negative amounts, mixed currencies, or unequal total debits and credits. `postSuccess` inserts the parent transaction and both entries via one Prisma transaction. Database checks enforce positive entry amounts and a two-account whitelist; unique keys guard duplicate inserts. PostgreSQL `BEFORE UPDATE/DELETE` triggers reject mutation of posted entry and parent rows.

**Correction model:** Historical ledger entries cannot be edited or deleted. A production system would append a separately identified, balanced reversal/compensating transaction and build a controlled refund/reversal workflow. Such a correction API is **not implemented**; this project deliberately prevents silent edits but does not support payouts or refunds. The present schema's unique one-to-one payment posting requires extension to model multiple reversals correctly.

**Important caveat:** PostgreSQL **does not** enforce cross-row balancing or minimum entry count with a deferred trigger. That invariant is guaranteed only when writes go through the trusted `postSuccess` service and its transaction. A privileged direct database writer could insert an unbalanced ledger transaction or append extra rows. Production hardening would restrict direct DML, add deferred trigger/ledger posting procedure or enforce an audited posting-only DB role, and extend the chart of accounts.

**Tests authored:** successful two-entry posting; duplicate event; competing concurrent postings; failed/terminal payments; unbalanced draft rejection; constraint-failure transaction rollback; mutation trigger rejection. Database tests still need execution in PostgreSQL.
