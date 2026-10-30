/** Deterministic demonstration against the running API. Does not persist a real secret. */
import { PrismaClient } from '@prisma/client';
import { issueKey } from '../src/modules/merchants/api-keys.js';
import { createHmac } from 'node:crypto';
const db = new PrismaClient();
const base = process.env.API_URL ?? 'http://localhost:3000';
const secret = process.env.SIMULATOR_WEBHOOK_SECRET;
async function main() {
    if (!secret)
        throw new Error('SIMULATOR_WEBHOOK_SECRET is required');
    const merchant = await db.merchant.findUniqueOrThrow({ where: { slug: 'demo-one' } });
    const key = await issueKey(db, merchant.id, 'workflow ephemeral');
    const headers = { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' };
    const paymentRes = await fetch(`${base}/api/v1/payments`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'workflow-' + crypto.randomUUID() }, body: JSON.stringify({ amount: '2500', currency: 'KES', scenario: 'processing' }) });
    if (!paymentRes.ok)
        throw new Error(`Payment create ${paymentRes.status}: ${await paymentRes.text()}`);
    const { data: payment } = await paymentRes.json() as {
        data: {
            id: string;
            providerTransactionId: string;
        };
    };
    const payload = { eventId: `workflow-${payment.id}`, paymentId: payment.id, externalId: payment.providerTransactionId, outcome: 'SUCCEEDED' };
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const webhookRes = await fetch(`${base}/api/v1/webhooks/provider/simulator`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-simulator-signature': signature }, body });
    if (!webhookRes.ok)
        throw new Error(`Webhook ${webhookRes.status}: ${await webhookRes.text()}`);
    const report = `provider_transaction_id,amount,currency,status,timestamp\n${payment.providerTransactionId},2500,KES,SUCCEEDED,2026-10-29T10:00:00.000Z\nsim-missing-${payment.id},900,KES,SUCCEEDED,2026-10-29T10:01:00.000Z\n`;
    const imported = await fetch(`${base}/api/v1/reconciliation/imports`, { method: 'POST', headers, body: JSON.stringify({ provider: 'simulator', filename: 'workflow.csv', csv: report }) });
    if (!imported.ok)
        throw new Error(`Import ${imported.status}: ${await imported.text()}`);
    const importId = ((await imported.json()) as {
        data: {
            id: string;
        };
    }).data.id;
    const run = await fetch(`${base}/api/v1/reconciliation/runs`, { method: 'POST', headers, body: JSON.stringify({ importId }) });
    if (!run.ok)
        throw new Error(`Run ${run.status}: ${await run.text()}`);
    console.log(JSON.stringify({ paymentId: payment.id, webhook: await webhookRes.json(), run: await run.json() }, null, 2));
    await db.apiKey.updateMany({ where: { hash: (await import('../src/modules/merchants/api-keys.js')).hashApiKey(key) }, data: { revokedAt: new Date() } });
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
