import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const merchants = [
    ["demo-one", "Demo Merchant One"],
    ["demo-two", "Demo Merchant Two"],
  ] as const;
  for (const [slug, name] of merchants) {
    await db.merchant.upsert({
      where: { slug },
      update: { name },
      create: { slug, name },
    });
  }
  console.log(
    "Two merchants seeded. Use npm run db:key -- demo-one to issue an API key.",
  );
}
main().finally(() => db.$disconnect());
