import { z } from "zod";
export const CURRENCIES = { KES: 2, USD: 2, JPY: 0, KWD: 3 } as const;
export const currencySchema = z.enum(["KES", "USD", "JPY", "KWD"]);
export const moneySchema = z
  .string()
  .regex(/^[1-9]\d{0,12}$/, "Positive integer minor units required")
  .refine(
    (v) => /^[1-9]\d{0,12}$/.test(v) && BigInt(v) <= 1000000000000n,
    "Amount exceeds limit",
  );
export const paymentInputSchema = z
  .object({
    amount: moneySchema,
    currency: currencySchema,
    description: z.string().trim().max(200).optional(),
    scenario: z
      .enum([
        "success",
        "failure",
        "processing",
        "timeout",
        "timeout-after-accept",
        "hold",
      ])
      .default("success"),
  })
  .strict();
export function toMinorUnits(amount: string): bigint {
  return BigInt(moneySchema.parse(amount));
}
