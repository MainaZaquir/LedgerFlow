import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { db, reset, secret } from '../helpers/db.js';
import { createApp } from '../../src/app.js';
const app = createApp(db, { secret, simulatorEnabled: true });
let keys: Awaited<ReturnType<typeof reset>>;
beforeEach(async () => { keys = await reset(); });
afterAll(async () => { await db.$disconnect(); });
function post(key: string, idem: string, body: object) { return request(app).post('/api/v1/payments').set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idem).send(body); }
describe('payments, idempotency and multi-tenancy (real PostgreSQL)', () => {
    it('creates a success and two balanced ledger entries exactly once', async () => {
        const one = await post(keys.keyOne, 'create-success-0001', { amount: '2500', currency: 'KES' });
        expect(one.status).toBe(201);
        expect(one.body.data.status).toBe('SUCCEEDED');
        expect(one.body.data.amount).toBe('2500');
        const again = await post(keys.keyOne, 'create-success-0001', { amount: '2500', currency: 'KES' });
        expect(again.status).toBe(201);
        expect(again.body.data.id).toBe(one.body.data.id);
        expect(await db.payment.count()).toBe(1);
        expect(await db.ledgerTransaction.count()).toBe(1);
        const entries = await db.ledgerEntry.findMany();
        expect(entries.map(e => [e.account, e.side, e.amount.toString()]).sort()).toEqual([['MERCHANT_PAYABLE', 'CREDIT', '2500'], ['PROVIDER_CLEARING', 'DEBIT', '2500']]);
    });
    it('rejects same key and changed payload, and isolates same key across merchants', async () => {
        expect((await post(keys.keyOne, 'collision-key-0001', { amount: '100', currency: 'USD' })).status).toBe(201);
        expect((await post(keys.keyOne, 'collision-key-0001', { amount: '101', currency: 'USD' })).status).toBe(409);
        expect((await post(keys.keyTwo, 'collision-key-0001', { amount: '101', currency: 'USD' })).status).toBe(201);
        expect(await db.payment.count()).toBe(2);
    });
    it('serializes concurrent same-key creates using a PostgreSQL advisory transaction lock', async () => {
        const calls = Array.from({ length: 8 }, () => post(keys.keyOne, 'same-key-concurrent-0123', { amount: '330', currency: 'KES' }));
        const results = await Promise.all(calls);
        expect(results.every(r => r.status === 201)).toBe(true);
        expect(new Set(results.map(r => r.body.data.id)).size).toBe(1);
        expect(await db.payment.count()).toBe(1);
        expect(await db.providerTransaction.count()).toBe(1);
        expect(await db.ledgerTransaction.count()).toBe(1);
    });
    it('never resubmits ambiguous timeout when client retries', async () => {
        const body = { amount: '500', currency: 'KES', scenario: 'timeout-after-accept' };
        const first = await post(keys.keyOne, 'ambiguous-timeout-0001', body);
        expect(first.status).toBe(201);
        expect(first.body.data.status).toBe('PROCESSING');
        const again = await post(keys.keyOne, 'ambiguous-timeout-0001', body);
        expect(again.body.data.id).toBe(first.body.data.id);
        const verified = await request(app).post(`/api/v1/payments/${first.body.data.id}/verify`).set('Authorization', `Bearer ${keys.keyOne}`);
        expect(verified.body.data.status).toBe('PROCESSING');
        expect(await db.providerTransaction.count()).toBe(1);
        expect(await db.ledgerTransaction.count()).toBe(0);
    });
    it('supports pending cancellation but rejects unsafe processing cancellation', async () => {
        const held = await post(keys.keyOne, 'hold-pending-0001', { amount: '50', currency: 'JPY', scenario: 'hold' });
        expect(held.body.data.status).toBe('PENDING');
        const cancel = await request(app).post(`/api/v1/payments/${held.body.data.id}/cancel`).set('Authorization', `Bearer ${keys.keyOne}`);
        expect(cancel.status).toBe(200);
        expect(cancel.body.data.status).toBe('CANCELLED');
        expect((await request(app).post(`/api/v1/payments/${held.body.data.id}/cancel`).set('Authorization', `Bearer ${keys.keyOne}`)).status).toBe(409);
        const active = await post(keys.keyOne, 'hold-active-0001', { amount: '50', currency: 'KES', scenario: 'processing' });
        expect((await request(app).post(`/api/v1/payments/${active.body.data.id}/cancel`).set('Authorization', `Bearer ${keys.keyOne}`)).status).toBe(409);
        expect(await db.ledgerTransaction.count()).toBe(0);
    });
    it('enforces merchant isolation for payment and ledger access', async () => {
        const created = await post(keys.keyOne, 'secure-payment-01', { amount: '321', currency: 'KES' });
        const id = created.body.data.id;
        expect((await request(app).get(`/api/v1/payments/${id}`).set('Authorization', `Bearer ${keys.keyTwo}`)).status).toBe(404);
        expect((await request(app).get('/api/v1/payments').set('Authorization', `Bearer ${keys.keyTwo}`)).body.data).toEqual([]);
        const ledger = await db.ledgerTransaction.findFirstOrThrow();
        expect((await request(app).get(`/api/v1/ledger/transactions/${ledger.id}`).set('Authorization', `Bearer ${keys.keyTwo}`)).status).toBe(404);
        expect((await request(app).get('/api/v1/ledger/transactions').set('Authorization', `Bearer ${keys.keyTwo}`)).body.data).toEqual([]);
        expect((await request(app).get('/api/v1/payments').set('Authorization', 'Bearer wrong')).status).toBe(401);
    });
    it('validates input, malformed JSON, pagination, body limits and errors', async () => {
        expect((await post(keys.keyOne, 'bad-money-0000001', { amount: 1.9, currency: 'KES' })).status).toBe(400);
        expect((await post(keys.keyOne, 'bad-money-0000002', { amount: '-1', currency: 'KES' })).status).toBe(400);
        expect((await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${keys.keyOne}`).send({ amount: '10', currency: 'KES' })).status).toBe(400);
        expect((await request(app).get('/api/v1/payments?page=-1').set('Authorization', `Bearer ${keys.keyOne}`)).status).toBe(400);
        const malformed = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${keys.keyOne}`).set('Content-Type', 'application/json').send('{oops');
        expect(malformed.status).toBe(400);
        expect(JSON.stringify(malformed.body)).not.toContain('stack');
        expect((await request(app).get('/api/v1/payments/nope').set('Authorization', `Bearer ${keys.keyOne}`)).status).toBe(400);
    });
    it('reports readiness from PostgreSQL and serves OpenAPI', async () => {
        expect((await request(app).get('/health')).status).toBe(200);
        expect((await request(app).get('/ready')).body.status).toBe('ready');
        const docs = await request(app).get('/openapi.json');
        expect(docs.status).toBe(200);
        expect(docs.body.paths['/api/v1/payments'].post).toBeDefined();
    });
});
