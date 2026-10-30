import type { PrismaClient } from "@prisma/client";
import { startProvider, verifyProvider, type Scenario } from "./simulator.js";
/** Adapter contract. External adapters must reserve a stable provider operation identity. */
export interface PaymentProvider {
  submit(
    db: PrismaClient,
    merchantId: string,
    paymentId: string,
    scenario: Scenario,
  ): Promise<void>;
  verify(
    db: PrismaClient,
    merchantId: string,
    paymentId: string,
  ): Promise<void>;
}
export const simulatorProvider: PaymentProvider = {
  submit: startProvider,
  verify: verifyProvider,
};
