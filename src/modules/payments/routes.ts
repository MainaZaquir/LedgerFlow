import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { merchantId } from '../../middleware/auth.js';
import { validate, uuidSchema } from '../../shared/validation/parse.js';
import { paymentInputSchema } from '../../shared/validation/money.js';
import { AppError, notFound } from '../../shared/errors/AppError.js';
import { createPayment, cancelPayment } from './service.js';
import { serializePayment } from './serialize.js';
import { simulatorProvider } from '../providers/provider.js';
const asyncRoute = (fn: (req: import('express').Request, res: import('express').Response) => Promise<void>) => (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
const listSchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export function paymentRoutes(db: PrismaClient) {
    const router = Router();
    router.post('/', asyncRoute(async (req, res) => {
        const key = req.header('idempotency-key');
        if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
            throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must be 8-128 permitted characters');
        const body = validate(paymentInputSchema, req.body);
        const result = await createPayment(db, merchantId(req), key, body);
        res.status(201).json({ data: serializePayment(result) });
    }));
    router.get('/', asyncRoute(async (req, res) => {
        const { page, limit } = validate(listSchema, req.query);
        const records = await db.payment.findMany({ where: { merchantId: merchantId(req) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit + 1, include: { providerTxn: true } });
        res.json({ data: records.slice(0, limit).map(serializePayment), pagination: { page, limit, hasMore: records.length > limit } });
    }));
    router.get('/:id', asyncRoute(async (req, res) => {
        const id = validate(uuidSchema, req.params.id);
        const record = await db.payment.findFirst({ where: { id, merchantId: merchantId(req) }, include: { providerTxn: true } });
        if (!record)
            throw notFound();
        res.json({ data: serializePayment(record) });
    }));
    router.post('/:id/cancel', asyncRoute(async (req, res) => {
        const id = validate(uuidSchema, req.params.id);
        const result = await cancelPayment(db, merchantId(req), id);
        res.json({ data: serializePayment(result) });
    }));
    router.post('/:id/verify', asyncRoute(async (req, res) => {
        const id = validate(uuidSchema, req.params.id);
        await simulatorProvider.verify(db, merchantId(req), id);
        const record = await db.payment.findFirst({ where: { id, merchantId: merchantId(req) }, include: { providerTxn: true } });
        if (!record)
            throw notFound();
        res.json({ data: serializePayment(record) });
    }));
    return router;
}
