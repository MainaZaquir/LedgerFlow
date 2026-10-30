import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
} from "../../src/modules/payments/state.js";
import {
  moneySchema,
  currencySchema,
} from "../../src/shared/validation/money.js";
import { fingerprint } from "../../src/modules/idempotency/fingerprint.js";
import { assertBalanced } from "../../src/modules/ledger/service.js";
import {
  signWebhook,
  verifyWebhook,
} from "../../src/modules/webhooks/service.js";
import { matchReport } from "../../src/modules/reconciliation/matcher.js";
import { AppError } from "../../src/shared/errors/AppError.js";
describe("domain invariants", () => {
  it("restricts payment state transitions and terminal state mutation", () => {
    expect(canTransition("PENDING", "PROCESSING")).toBe(true);
    expect(canTransition("PENDING", "CANCELLED")).toBe(true);
    expect(canTransition("PROCESSING", "SUCCEEDED")).toBe(true);
    expect(canTransition("PROCESSING", "FAILED")).toBe(true);
    for (const terminal of ["SUCCEEDED", "FAILED", "CANCELLED"] as const)
      for (const next of [
        "PROCESSING",
        "FAILED",
        "SUCCEEDED",
        "CANCELLED",
      ] as const)
        expect(canTransition(terminal, next)).toBe(false);
    expect(() => assertTransition("SUCCEEDED", "FAILED")).toThrow(AppError);
  });
  it("validates supported money as bounded integer minor units", () => {
    for (const amount of [
      "0",
      "-1",
      "1.5",
      "01",
      "1e3",
      "NaN",
      " ",
      "9007199254740993",
      "1000000000001",
    ])
      expect(moneySchema.safeParse(amount).success).toBe(false);
    expect(moneySchema.parse("1000000000000")).toBe("1000000000000");
    expect(currencySchema.safeParse("EUR").success).toBe(false);
  });
  it("hashes fingerprints independent of key ordering and sensitive to changed fields", () => {
    expect(fingerprint({ amount: "200", currency: "KES" })).toBe(
      fingerprint({ currency: "KES", amount: "200" }),
    );
    expect(fingerprint({ amount: "200", currency: "KES" })).not.toBe(
      fingerprint({ amount: "201", currency: "KES" }),
    );
  });
  it("rejects unbalanced, zero or mixed currency postings", () => {
    const pair = [
      {
        account: "PROVIDER_CLEARING",
        side: "DEBIT",
        amount: 100n,
        currency: "KES",
      },
      {
        account: "MERCHANT_PAYABLE",
        side: "CREDIT",
        amount: 100n,
        currency: "KES",
      },
    ] as const;
    expect(() => assertBalanced(pair)).not.toThrow();
    expect(() =>
      assertBalanced([pair[0], { ...pair[1], amount: 99n }]),
    ).toThrow("unbalanced");
    expect(() =>
      assertBalanced([pair[0], { ...pair[1], amount: 0n }]),
    ).toThrow();
    expect(() =>
      assertBalanced([pair[0], { ...pair[1], currency: "USD" }]),
    ).toThrow();
  });
  it("authenticates exact raw webhook bytes using HMAC", () => {
    const raw = Buffer.from('{"eventId":"e1"}');
    const secret = "test-secret-123456789012345678901234";
    expect(verifyWebhook(secret, raw, signWebhook(secret, raw))).toBe(true);
    expect(
      verifyWebhook(
        secret,
        Buffer.from('{"eventId":"e2"}'),
        signWebhook(secret, raw),
      ),
    ).toBe(false);
    expect(verifyWebhook(secret, raw, "sha256=oops")).toBe(false);
    expect(verifyWebhook(secret, raw, undefined)).toBe(false);
  });
  it("classifies reconciliation without guessing a payment by amount", () => {
    const internal = [
      {
        paymentId: "a",
        externalId: "a",
        amount: 100n,
        currency: "KES",
        status: "SUCCEEDED" as const,
      },
      {
        paymentId: "b",
        externalId: "b",
        amount: 50n,
        currency: "KES",
        status: "FAILED" as const,
      },
      {
        paymentId: "c",
        externalId: "c",
        amount: 100n,
        currency: "KES",
        status: "ACCEPTED" as const,
      },
    ];
    const report = [
      {
        id: "1",
        externalId: "a",
        amount: 101n,
        currency: "KES",
        status: "SUCCEEDED" as const,
      },
      {
        id: "2",
        externalId: "b",
        amount: 50n,
        currency: "USD",
        status: "FAILED" as const,
      },
      {
        id: "3",
        externalId: "c",
        amount: 100n,
        currency: "KES",
        status: "SUCCEEDED" as const,
      },
      {
        id: "4",
        externalId: "missing",
        amount: 100n,
        currency: "KES",
        status: "SUCCEEDED" as const,
      },
      {
        id: "5",
        externalId: "dup",
        amount: 10n,
        currency: "KES",
        status: "FAILED" as const,
      },
      {
        id: "6",
        externalId: "dup",
        amount: 10n,
        currency: "KES",
        status: "FAILED" as const,
      },
    ];
    const outcomes = matchReport(internal, report).map((i) => i.status);
    expect(outcomes).toEqual([
      "AMOUNT_MISMATCH",
      "CURRENCY_MISMATCH",
      "AMBIGUOUS",
      "MISSING_INTERNAL",
      "DUPLICATE_PROVIDER",
      "DUPLICATE_PROVIDER",
    ]);
    expect(matchReport([internal[0]!], [])[0]?.status).toBe("MISSING_PROVIDER");
    expect(
      matchReport(
        [internal[0]!],
        [{ ...report[0]!, amount: 100n, status: "FAILED" }],
      )[0]?.status,
    ).toBe("STATUS_MISMATCH");
  });
});
