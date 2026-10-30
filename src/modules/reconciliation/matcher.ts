import type { ProviderStatus, ReconciliationStatus } from "@prisma/client";
export type InternalRow = {
  paymentId: string;
  externalId: string;
  amount: bigint;
  currency: string;
  status: ProviderStatus;
};
export type ExternalRow = {
  id: string;
  externalId: string;
  amount: bigint;
  currency: string;
  status: ProviderStatus;
};
export type MatchItem = {
  paymentId: string | null;
  reportRowId: string | null;
  externalId: string;
  status: ReconciliationStatus;
  detail: string;
};
/** Identifiers are exact matches. Never guess by amount or timestamp. */
export function matchReport(
  internal: readonly InternalRow[],
  report: readonly ExternalRow[],
): MatchItem[] {
  const grouped = new Map<string, ExternalRow[]>();
  for (const row of report)
    grouped.set(row.externalId, [...(grouped.get(row.externalId) ?? []), row]);
  const local = new Map(internal.map((row) => [row.externalId, row]));
  const items: MatchItem[] = [];
  for (const [externalId, rows] of grouped) {
    const found = local.get(externalId);
    if (rows.length > 1) {
      for (const row of rows)
        items.push({
          paymentId: found?.paymentId ?? null,
          reportRowId: row.id,
          externalId,
          status: "DUPLICATE_PROVIDER",
          detail: "Repeated external ID in imported report",
        });
      continue;
    }
    const row = rows[0];
    if (!row) continue;
    if (!found) {
      items.push({
        paymentId: null,
        reportRowId: row.id,
        externalId,
        status: "MISSING_INTERNAL",
        detail: "Provider report has no internal transaction",
      });
      continue;
    }
    let status: ReconciliationStatus = "MATCHED";
    let detail = "Exact external ID, amount, currency, and status match";
    if (found.currency !== row.currency) {
      status = "CURRENCY_MISMATCH";
      detail = "Currency differs";
    } else if (found.amount !== row.amount) {
      status = "AMOUNT_MISMATCH";
      detail = "Minor-unit amount differs";
    } else if (found.status === "UNKNOWN" || found.status === "ACCEPTED") {
      status = "AMBIGUOUS";
      detail = "Internal provider outcome remains unconfirmed";
    } else if (found.status !== row.status) {
      status = "STATUS_MISMATCH";
      detail = "Provider and internal statuses differ";
    }
    items.push({
      paymentId: found.paymentId,
      reportRowId: row.id,
      externalId,
      status,
      detail,
    });
  }
  for (const row of internal) {
    if (!grouped.has(row.externalId))
      items.push({
        paymentId: row.paymentId,
        reportRowId: null,
        externalId: row.externalId,
        status: "MISSING_PROVIDER",
        detail: "Internal provider transaction absent from report",
      });
  }
  return items;
}
