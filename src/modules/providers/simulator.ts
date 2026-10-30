import { Prisma, type PrismaClient, type ProviderStatus } from "@prisma/client";
import { conflict, notFound } from "../../shared/errors/AppError.js";
import { ingestEvent } from "../webhooks/service.js";
export const SIMULATOR = "simulator";
export type Scenario =
  | "success"
  | "failure"
  | "processing"
  | "timeout"
  | "timeout-after-accept"
  | "hold";
/** Provider operation key is payment ID. A reserved operation is NEVER sent twice. */
export async function startProvider(
  db: PrismaClient,
  merchantId: string,
  paymentId: string,
  scenario: Scenario,
): Promise<void> {
  const transaction = await db.$transaction(
    async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, merchantId },
      });
      if (!payment) throw notFound();
      const changed = await tx.payment.updateMany({
        where: { id: paymentId, merchantId, status: "PENDING" },
        data: { status: "PROCESSING" },
      });
      if (changed.count !== 1) throw conflict("Payment already started");
      const truth: ProviderStatus =
        scenario === "success"
          ? "SUCCEEDED"
          : scenario === "failure"
            ? "FAILED"
            : scenario === "timeout"
              ? "UNKNOWN"
              : "ACCEPTED";
      return tx.providerTransaction.create({
        data: {
          merchantId,
          paymentId,
          provider: SIMULATOR,
          externalId: `sim-${paymentId}`,
          status: truth,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
  // The database reservation above is committed before any provider-like outcome processing.
  if (transaction.status === "SUCCEEDED" || transaction.status === "FAILED") {
    await ingestEvent(db, SIMULATOR, {
      eventId: `initial-${paymentId}-${transaction.status}`,
      paymentId,
      externalId: transaction.externalId,
      outcome: transaction.status,
    });
  }
}
/** Recovery only consumes durable provider status; it never creates a second external operation. */
export async function verifyProvider(
  db: PrismaClient,
  merchantId: string,
  paymentId: string,
): Promise<void> {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, merchantId },
    include: { providerTxn: true },
  });
  if (!payment) throw notFound();
  const txn = payment.providerTxn;
  if (payment.status !== "PROCESSING" || !txn) return;
  if (txn.status === "SUCCEEDED" || txn.status === "FAILED") {
    await ingestEvent(db, txn.provider, {
      eventId: `verify-${paymentId}-${txn.status}`,
      paymentId,
      externalId: txn.externalId,
      outcome: txn.status,
    });
  }
}
