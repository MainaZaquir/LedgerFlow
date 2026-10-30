import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
export async function issueKey(
  db: PrismaClient,
  merchantId: string,
  label: string,
): Promise<string> {
  const secret = `lf_test_${randomBytes(32).toString("base64url")}`;
  await db.apiKey.create({
    data: { merchantId, label, hash: hashApiKey(secret) },
  });
  return secret; // shown only at issuance; cannot retrieve from database
}
