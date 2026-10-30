import { Prisma, type PrismaClient } from "@prisma/client";
import { fingerprint } from "../idempotency/fingerprint.js";
import { conflict, notFound } from "../../shared/errors/AppError.js";
import type { z } from "zod";
import { paymentInputSchema } from "../../shared/validation/money.js";
import { simulatorProvider } from "../providers/provider.js";
import { logger } from "../../shared/logging/logger.js";
export type CreatePayment = z.infer<typeof paymentInputSchema>;
export async function createPayment(
  db: PrismaClient,
  merchantId: string,
  key: string,
  request: CreatePayment,
) {
  // Exclude simulator scenario from the monetary request fingerprint? No: scenario changes must conflict.
  const hash = fingerprint(request);
  const { paymentId, fresh } = await db.$transaction(
    async (tx) => {
      // PostgreSQL transaction-scoped lock, namespaced by merchant, endpoint, and idempotency key.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`${merchantId}:payments:create:${key}`}, 0)) AS guard) AS acquired`;
      const prior = await tx.idempotencyRecord.findUnique({
        where: {
          merchantId_operation_key: {
            merchantId,
            operation: "payments:create",
            key,
          },
        },
      });
      if (prior) {
        if (prior.fingerprint !== hash)
          throw conflict("Idempotency key reused with a different request");
        return { paymentId: prior.paymentId, fresh: false };
      }
      const payment = await tx.payment.create({
        data: {
          merchantId,
          amount: BigInt(request.amount),
          currency: request.currency,
          description: request.description ?? null,
        },
      });
      await tx.idempotencyRecord.create({
        data: {
          merchantId,
          operation: "payments:create",
          key,
          fingerprint: hash,
          paymentId: payment.id,
        },
      });
      return { paymentId: payment.id, fresh: true };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10000,
    },
  );
  if (fresh && request.scenario !== "hold") {
    try {
      await simulatorProvider.submit(
        db,
        merchantId,
        paymentId,
        request.scenario,
      );
    } catch (error) {
      // The durable logical payment remains retrievable. Unexpected provider processing failures
      // are logged and returned as an error; a retry NEVER invokes startProvider again.
      logger.error(
        { err: error, paymentId },
        "Provider operation/processing failed",
      );
      throw error;
    }
  }
  return db.payment.findFirstOrThrow({
    where: { id: paymentId, merchantId },
    include: { providerTxn: true },
  });
}
export async function cancelPayment(
  db: PrismaClient,
  merchantId: string,
  id: string,
) {
  await db.$transaction(async (tx) => {
    const changed = await tx.payment.updateMany({
      where: { id, merchantId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (changed.count === 0) {
      const payment = await tx.payment.findFirst({ where: { id, merchantId } });
      if (!payment) throw notFound();
      throw conflict(`Cannot cancel payment in state ${payment.status}`);
    }
    await tx.auditLog.create({
      data: {
        merchantId,
        action: "PAYMENT_CANCELLED",
        targetId: id,
        detail: {},
      },
    });
  });
  return db.payment.findFirstOrThrow({
    where: { id, merchantId },
    include: { providerTxn: true },
  });
}
