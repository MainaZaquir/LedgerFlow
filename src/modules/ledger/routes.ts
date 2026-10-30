import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import { merchantId } from '../../middleware/auth.js';
import { validate, uuidSchema } from '../../shared/validation/parse.js';
import { notFound } from '../../shared/errors/AppError.js';
import { z } from 'zod';
const paging = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
function serialize(row: {
    id: string;
    paymentId: string;
    postingKey: string;
    currency: string;
    createdAt: Date;
    entries: {
        id: string;
        account: string;
        side: string;
        amount: bigint;
        currency: string;
    }[];
}) {
    return { id: row.id, paymentId: row.paymentId, postingKey: row.postingKey, currency: row.currency, createdAt: row.createdAt,
        entries: row.entries.map(e => ({ id: e.id, account: e.account, side: e.side, amount: e.amount.toString(), currency: e.currency })) };
}
export function ledgerRoutes(db: PrismaClient) {
    const router = Router();
    const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
    router.get('/transactions', wrap(async (req, res) => {
        const { page, limit } = validate(paging, req.query);
        const items = await db.ledgerTransaction.findMany({ where: { merchantId: merchantId(req) }, include: { entries: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit + 1 });
        res.json({ data: items.slice(0, limit).map(serialize), pagination: { page, limit, hasMore: items.length > limit } });
    }));
    router.get('/transactions/:id', wrap(async (req, res) => {
        const id = validate(uuidSchema, req.params.id);
        const item = await db.ledgerTransaction.findFirst({ where: { id, merchantId: merchantId(req) }, include: { entries: true } });
        if (!item)
            throw notFound();
        res.json({ data: serialize(item) });
    }));
    return router;
}
