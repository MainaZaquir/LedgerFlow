import { PrismaClient } from '@prisma/client';
import { issueKey } from '../../src/modules/merchants/api-keys.js';
export const secret = 'integration-test-secret-at-least-32-characters-long';
const url = process.env.DATABASE_URL_TEST;
if (!url)
    throw new Error('DATABASE_URL_TEST required for integration tests. Never point it at production.');
if (!/ledgerflow_test/.test(url))
    throw new Error('Test database URL must contain ledgerflow_test to prevent destructive cleanup.');
export const db = new PrismaClient({ datasources: { db: { url } } });
export async function reset() {
    await db.$executeRawUnsafe('TRUNCATE TABLE "WebhookEvent", "Merchant" CASCADE');
    const one = await db.merchant.create({ data: { slug: 'one', name: 'One' } });
    const two = await db.merchant.create({ data: { slug: 'two', name: 'Two' } });
    return { one, two, keyOne: await issueKey(db, one.id, 'test'), keyTwo: await issueKey(db, two.id, 'test') };
}
