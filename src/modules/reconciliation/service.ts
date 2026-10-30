import { Prisma, type PrismaClient, type ProviderStatus } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../shared/errors/AppError.js';
import { validate } from '../../shared/validation/parse.js';
import { moneySchema, currencySchema } from '../../shared/validation/money.js';
import { matchReport } from './matcher.js';
const importSchema = z.object({ provider: z.literal('simulator'), filename: z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+\.csv$/), csv: z.string().min(1).max(100000) }).strict();
const rowSchema = z.object({ provider_transaction_id: z.string().min(1).max(150), amount: moneySchema, currency: currencySchema, status: z.enum(['UNKNOWN', 'ACCEPTED', 'SUCCEEDED', 'FAILED']), timestamp: z.string().datetime({ offset: true }) }).strict();
const HEADERS = ['provider_transaction_id', 'amount', 'currency', 'status', 'timestamp'];
export function parseReport(csv: string) {
    let records: Record<string, string>[];
    try {
        records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: false, trim: true, max_record_size: 500 }) as Record<string, string>[];
    }
    catch {
        throw badRequest('Malformed CSV report');
    }
    if (!records.length || records.length > 1000)
        throw badRequest('Report must contain 1-1000 rows');
    return records.map((row, index) => {
        if (JSON.stringify(Object.keys(row)) !== JSON.stringify(HEADERS))
            throw badRequest('Invalid CSV column names/order');
        const parsed = validate(rowSchema, row);
        return { lineNumber: index + 2, externalId: parsed.provider_transaction_id, amount: BigInt(parsed.amount), currency: parsed.currency, status: parsed.status, occurredAt: new Date(parsed.timestamp) };
    });
}
export async function importReport(db: PrismaClient, merchantId: string, input: unknown) {
    const req = validate(importSchema, input);
    const rows = parseReport(req.csv);
    return db.reconciliationImport.create({ data: { merchantId, provider: req.provider, filename: req.filename, rows: { create: rows } }, select: { id: true, filename: true, provider: true, createdAt: true, _count: { select: { rows: true } } } });
}
export async function runReconciliation(db: PrismaClient, merchantId: string, importId: string) {
    return db.$transaction(async (tx) => {
        const importFile = await tx.reconciliationImport.findFirst({ where: { id: importId, merchantId }, include: { rows: true } });
        if (!importFile)
            throw notFound();
        const existing = await tx.reconciliationRun.findUnique({ where: { merchantId_importId: { merchantId, importId } } });
        if (existing)
            throw conflict('Import has already been reconciled');
        const internal = await tx.providerTransaction.findMany({ where: { merchantId, provider: importFile.provider }, include: { payment: true } });
        const items = matchReport(internal.map(t => ({ paymentId: t.paymentId, externalId: t.externalId, amount: t.payment.amount, currency: t.payment.currency, status: (t.payment.status === 'SUCCEEDED' ? 'SUCCEEDED' : t.payment.status === 'FAILED' ? 'FAILED' : t.status === 'UNKNOWN' ? 'UNKNOWN' : 'ACCEPTED') as ProviderStatus })), importFile.rows.map(r => ({ id: r.id, externalId: r.externalId, amount: r.amount, currency: r.currency, status: r.status })));
        const run = await tx.reconciliationRun.create({ data: { merchantId, importId, items: { create: items.map(i => ({
                        externalId: i.externalId, status: i.status, detail: i.detail,
                        ...(i.paymentId ? { payment: { connect: { id: i.paymentId } } } : {}),
                        ...(i.reportRowId ? { reportRow: { connect: { id: i.reportRowId } } } : {})
                    })) } } });
        await tx.auditLog.create({ data: { merchantId, action: 'RECONCILIATION_RUN', targetId: run.id, detail: { importId, items: items.length } } });
        return run;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}
export async function resolveException(db: PrismaClient, merchantId: string, id: string, resolution: string) {
    return db.$transaction(async (tx) => {
        // Scope first; atomic conditional update prevents duplicate resolutions.
        const item = await tx.reconciliationItem.findFirst({ where: { id, run: { merchantId } } });
        if (!item)
            throw notFound();
        if (item.status === 'MATCHED')
            throw conflict('Matched rows are not exceptions');
        const updated = await tx.reconciliationItem.updateMany({ where: { id, resolvedAt: null }, data: { resolution, resolvedAt: new Date() } });
        if (updated.count !== 1)
            throw conflict('Exception already resolved');
        await tx.auditLog.create({ data: { merchantId, action: 'RECONCILIATION_EXCEPTION_RESOLVED', targetId: id, detail: { resolution } } });
        return tx.reconciliationItem.findUniqueOrThrow({ where: { id } });
    });
}
