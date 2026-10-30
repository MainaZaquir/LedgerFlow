import { PrismaClient } from "@prisma/client";
import { issueKey } from "../src/modules/merchants/api-keys.js";
const db = new PrismaClient();
async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Usage: npm run db:key -- demo-one");
  const merchant = await db.merchant.findUnique({ where: { slug } });
  if (!merchant) throw new Error("Unknown merchant slug");
  const key = await issueKey(db, merchant.id, "local development");
  console.log("Copy this key once (never stored in plaintext):", key);
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
