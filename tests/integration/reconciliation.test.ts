import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { db, reset, secret } from '../helpers/db.js';
import { createApp } from '../../src/app.js';
const app = createApp(db, { secret, simulatorEnabled: true });
let keys: Awaited<ReturnType<typeof reset>>;
beforeEach(async () => { keys = await reset(); });
afterAll(async () => { await db.$disconnect(); });
const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
async function payment(amount: string, scenario: string) {
    const res = await request(app).post('/api/v1/payments').set(auth(keys.keyOne)).set('Idempotency-Key', `reconcile-${crypto.randomUUID()}`).send({ amount, currency: 'KES', scenario });
    expect(res.status).toBe(201);
    return res.body.data as {
        id: string;
        providerTransactionId: string;
    };
}
const header = 'provider_transaction_id,amount,currency,status,timestamp';
function csv(rows: string[]) { return [header, ...rows].join('\n') + '\n'; }
function line(id: string, amount = '100', currency = 'KES', status = 'SUCCEEDED') { return `${id},${amount},${currency},${status},2026-10-29T10:00:00.000Z`; }
describe('reconciliation persistence and isolation', () => {
    it('classifies every discrepancy and allows audited resolution without mutating payments', async () => {
        const match = await payment('100', 'success');
        const amount = await payment('200', 'success');
        const currency = await payment('300', 'success');
        const status = await payment('400', 'failure');
        const duplicate = await payment('500', 'success');
        const ambiguous = await payment('600', 'processing');
        const missing = await payment('700', 'success');
        const report = csv([
            line(match.providerTransactionId, '100'), line(amount.providerTransactionId, '201'),
            line(currency.providerTransactionId, '300', 'USD'), line(status.providerTransactionId, '400', 'KES', 'SUCCEEDED'),
            line(duplicate.providerTransactionId, '500'), line(duplicate.providerTransactionId, '500'),
            line(ambiguous.providerTransactionId, '600'), line('untracked-provider-999', '999')
        ]);
        const imported = await request(app).post('/api/v1/reconciliation/imports').set(auth(keys.keyOne)).send({ provider: 'simulator', filename: 'report.csv', csv: report });
        expect(imported.status).toBe(201);
        expect(imported.body.data._count.rows).toBe(8);
        const importId = imported.body.data.id as string;
        const run = await request(app).post('/api/v1/reconciliation/runs').set(auth(keys.keyOne)).send({ importId });
        expect(run.status).toBe(201);
        const details = await request(app).get(`/api/v1/reconciliation/runs/${run.body.data.id}`).set(auth(keys.keyOne));
        const outcomes = details.body.data.items.map((i: {
            status: string;
        }) => i.status) as string[];
        expect(outcomes.sort()).toEqual(['MATCHED', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'STATUS_MISMATCH', 'DUPLICATE_PROVIDER', 'DUPLICATE_PROVIDER', 'AMBIGUOUS', 'MISSING_INTERNAL', 'MISSING_PROVIDER'].sort());
        const target = details.body.data.items.find((i: {
            status: string;
        }) => i.status === 'AMOUNT_MISMATCH');
        const resolved = await request(app).post(`/api/v1/reconciliation/exceptions/${target.id}/resolve`).set(auth(keys.keyOne)).send({ resolution: 'Reviewed against provider statement; escalated for investigation' });
        expect(resolved.status).toBe(200);
        expect(resolved.body.data.resolvedAt).not.toBeNull();
        expect((await request(app).post(`/api/v1/reconciliation/exceptions/${target.id}/resolve`).set(auth(keys.keyOne)).send({ resolution: 'Second attempt' })).status).toBe(409);
        expect((await db.payment.findUniqueOrThrow({ where: { id: amount.id } })).amount).toBe(200n);
        expect((await db.payment.findUniqueOrThrow({ where: { id: missing.id } })).status).toBe('SUCCEEDED');
        expect(await db.auditLog.count({ where: { merchantId: keys.one.id, action: 'RECONCILIATION_EXCEPTION_RESOLVED' } })).toBe(1);
        expect((await request(app).get(`/api/v1/reconciliation/runs/${run.body.data.id}`).set(auth(keys.keyTwo))).status).toBe(404);
        expect((await request(app).post(`/api/v1/reconciliation/exceptions/${target.id}/resolve`).set(auth(keys.keyTwo)).send({ resolution: 'Cross-merchant unauthorized' })).status).toBe(404);
    });
    it('rejects malicious and invalid reports before persistence and refuses duplicate run', async () => {
        const invalid = [csv([line('id', '0')]), csv([line('id', '1.5')]), csv([line('id', '2', 'INVALID')]), 'malformed,header\na,b\n'];
        for (const contents of invalid) {
            const res = await request(app).post('/api/v1/reconciliation/imports').set(auth(keys.keyOne)).send({ provider: 'simulator', filename: 'bad.csv', csv: contents });
            expect(res.status).toBe(400);
        }
        expect(await db.reconciliationImport.count()).toBe(0);
        const valid = await request(app).post('/api/v1/reconciliation/imports').set(auth(keys.keyOne)).send({ provider: 'simulator', filename: 'good.csv', csv: csv([line('not-internal')]) });
        const importId = valid.body.data.id as string;
        expect((await request(app).post('/api/v1/reconciliation/runs').set(auth(keys.keyOne)).send({ importId })).status).toBe(201);
        expect((await request(app).post('/api/v1/reconciliation/runs').set(auth(keys.keyOne)).send({ importId })).status).toBe(409);
        expect((await request(app).post('/api/v1/reconciliation/runs').set(auth(keys.keyTwo)).send({ importId })).status).toBe(404);
    });
});
