import type { PaymentStatus } from "@prisma/client";
import { conflict } from "../../shared/errors/AppError.js";
const transitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return transitions[from].includes(to);
}
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to))
    throw conflict(`Cannot change payment from ${from} to ${to}`);
}
