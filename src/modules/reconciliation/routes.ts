import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { merchantId } from '../../middleware/auth.js';
import { validate, uuidSchema } from '../../shared/validation/parse.js';
import { notFound } from '../../shared/errors/AppError.js';
import { importReport, resolveException, runReconciliation } from './service.js';
export function reconciliationRoutes(db: PrismaClient) {
    const router = Router();
    const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
    router.post('/imports', wrap(async (req, res) => {
        const result = await importReport(db, merchantId(req), req.body);
        res.status(201).json({ data: result });
    }));
    router.post('/runs', wrap(async (req, res) => {
        const { importId } = validate(z.object({ importId: uuidSchema }).strict(), req.body);
        const run = await runReconciliation(db, merchantId(req), importId);
        res.status(201).json({ data: { id: run.id, importId: run.importId, createdAt: run.createdAt } });
    }));
    router.get('/runs/:id', wrap(async (req, res) => {
        const id = validate(uuidSchema, req.params.id);
        const run = await db.reconciliationRun.findFirst({ where: { id, merchantId: merchantId(req) }, include: { items: { orderBy: { id: 'asc' } } } });
        if (!run)
            throw notFound();
        res.json({ data: run });
    }));
    router.get('/exceptions', wrap(async (req, res) => {
        const query = validate(z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), unresolved: z.enum(['true', 'false']).default('true') }).strict(), req.query);
        const items = await db.reconciliationItem.findMany({ where: { run: { merchantId: merchantId(req) }, status: { not: 'MATCHED' }, ...(query.unresolved === 'true' ? { resolvedAt: null } : {}) }, orderBy: { id: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit + 1 });
        res.json({ data: items.slice(0, query.limit), pagination: { page: query.page, limit: query.limit, hasMore: items.length > query.limit } });
    }));
    router.post('/exceptions/:id/resolve', wrap(async (req, res) => {
        const id = validate(uuidSchema, req.params.id);
        const { resolution } = validate(z.object({ resolution: z.string().trim().min(5).max(500) }).strict(), req.body);
        const item = await resolveException(db, merchantId(req), id, resolution);
        res.json({ data: item });
    }));
    return router;
}
