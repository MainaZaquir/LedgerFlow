import { beforeEach, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { db, reset, secret } from "../helpers/db.js";
import { createApp } from "../../src/app.js";
import { signWebhook } from "../../src/modules/webhooks/service.js";
import { postSuccess } from "../../src/modules/ledger/service.js";
const app = createApp(db, { secret, simulatorEnabled: true });
let keys: Awaited<ReturnType<typeof reset>>;
beforeEach(async () => {
  keys = await reset();
});
afterAll(async () => {
  await db.$disconnect();
});
async function processingPayment(merchantKey: string, scenario = "processing") {
  const result = await request(app)
    .post("/api/v1/payments")
    .set("Authorization", `Bearer ${merchantKey}`)
    .set("Idempotency-Key", `key-${crypto.randomUUID()}`)
    .send({ amount: "12345", currency: "KES", scenario });
  expect(result.status).toBe(201);
  return result.body.data as {
    id: string;
    providerTransactionId: string;
    status: string;
  };
}
function deliver(payload: object, signature?: string) {
  const raw = JSON.stringify(payload);
  return request(app)
    .post("/api/v1/webhooks/provider/simulator")
    .set("Content-Type", "application/json")
    .set("x-simulator-signature", signature ?? signWebhook(secret, raw))
    .send(raw);
}
describe("webhook processing and ledger concurrency against PostgreSQL", () => {
  it("rejects forged signatures, malformed payload and unknown payment with retryable persisted failure", async () => {
    const p = await processingPayment(keys.keyOne);
    const event = {
      eventId: "valid-evt-1",
      paymentId: p.id,
      externalId: p.providerTransactionId,
      outcome: "SUCCEEDED",
    };
    expect((await deliver(event, "sha256=" + "0".repeat(64))).status).toBe(401);
    expect(await db.webhookEvent.count()).toBe(0);
    expect((await deliver({ ...event, outcome: "INVALID" })).status).toBe(400);
    expect(
      (
        await deliver({
          ...event,
          eventId: "unknown-payment-1",
          paymentId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(400);
    const rejected = await db.webhookEvent.findUniqueOrThrow({
      where: {
        provider_eventId: {
          provider: "simulator",
          eventId: "unknown-payment-1",
        },
      },
    });
    expect(rejected.status).toBe("FAILED");
    expect(rejected.attempts).toBe(1);
    expect(await db.ledgerTransaction.count()).toBe(0);
  });
  it("deduplicates concurrent signed events and exactly-once ledger posting", async () => {
    const p = await processingPayment(keys.keyOne);
    const payload = {
      eventId: "concurrent-evt-1",
      paymentId: p.id,
      externalId: p.providerTransactionId,
      outcome: "SUCCEEDED",
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => deliver(payload)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await db.webhookEvent.count()).toBe(1);
    expect(await db.ledgerTransaction.count()).toBe(1);
    expect(await db.ledgerEntry.count()).toBe(2);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe("SUCCEEDED");
    const another = { ...payload, eventId: "another-event-success" };
    expect((await deliver(another)).body.data.status).toBe("IGNORED");
    expect(await db.ledgerTransaction.count()).toBe(1);
  });
  it("terminal outcome is never reversed by a stale or out-of-order event", async () => {
    const p = await processingPayment(keys.keyOne);
    const failure = {
      eventId: "failure-first",
      paymentId: p.id,
      externalId: p.providerTransactionId,
      outcome: "FAILED",
    };
    expect((await deliver(failure)).body.data.status).toBe("PROCESSED");
    expect(
      (
        await deliver({
          ...failure,
          eventId: "success-later",
          outcome: "SUCCEEDED",
        })
      ).body.data.status,
    ).toBe("IGNORED");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe("FAILED");
    expect(await db.ledgerTransaction.count()).toBe(0);
  });
  it("concurrent distinct events compete on same payment; only first terminal wins", async () => {
    const p = await processingPayment(keys.keyOne);
    const base = { paymentId: p.id, externalId: p.providerTransactionId };
    const results = await Promise.all([
      deliver({ ...base, eventId: "success-compete", outcome: "SUCCEEDED" }),
      deliver({ ...base, eventId: "failed-compete", outcome: "FAILED" }),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(["SUCCEEDED", "FAILED"]).toContain(payment.status);
    expect(await db.ledgerTransaction.count()).toBe(
      payment.status === "SUCCEEDED" ? 1 : 0,
    );
    expect(await db.webhookEvent.count()).toBe(2);
  });
  it("rejects event ID rebind and unmatching external transaction", async () => {
    const p = await processingPayment(keys.keyOne);
    const base = {
      eventId: "fixed-event-id",
      paymentId: p.id,
      externalId: p.providerTransactionId,
      outcome: "SUCCEEDED",
    };
    expect((await deliver(base)).status).toBe(200);
    expect((await deliver({ ...base, outcome: "FAILED" })).status).toBe(409);
    const other = await processingPayment(keys.keyTwo);
    expect(
      (
        await deliver({
          ...base,
          eventId: "incorrect-provider-link",
          paymentId: other.id,
        })
      ).status,
    ).toBe(400);
  });
  it("enforces immutable ledger rows through database triggers", async () => {
    const p = await processingPayment(keys.keyOne);
    await deliver({
      eventId: "immutable-evt",
      paymentId: p.id,
      externalId: p.providerTransactionId,
      outcome: "SUCCEEDED",
    });
    const entry = await db.ledgerEntry.findFirstOrThrow();
    await expect(
      db.ledgerEntry.update({ where: { id: entry.id }, data: { amount: 1n } }),
    ).rejects.toThrow();
    await expect(
      db.ledgerEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow();
  });
  it("rolls back a partial posting after a database constraint error", async () => {
    const held = await processingPayment(keys.keyOne, "processing");
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: held.id },
    });
    await expect(
      db.$transaction(async (tx) => {
        await postSuccess(tx, payment);
        // Force DB-level invalid row; atomic transaction must roll back both legitimate entries.
        await tx.ledgerEntry.create({
          data: {
            transactionId: (await tx.ledgerTransaction.findFirstOrThrow()).id,
            account: "PROVIDER_CLEARING",
            side: "DEBIT",
            amount: -1n,
            currency: "KES",
          },
        });
      }),
    ).rejects.toThrow();
    expect(await db.ledgerTransaction.count()).toBe(0);
    expect(await db.ledgerEntry.count()).toBe(0);
  });
  it("prevents duplicate concurrent postings by DB unique constraint", async () => {
    const held = await processingPayment(keys.keyOne, "processing");
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: held.id },
    });
    const results = await Promise.allSettled([
      db.$transaction((tx) => postSuccess(tx, payment)),
      db.$transaction((tx) => postSuccess(tx, payment)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
    expect(await db.ledgerEntry.count()).toBe(2);
  });
  it("database rejects non-positive payment amounts regardless of API validation", async () => {
    await expect(
      db.payment.create({
        data: { merchantId: keys.one.id, amount: -10n, currency: "KES" },
      }),
    ).rejects.toThrow();
  });
});
