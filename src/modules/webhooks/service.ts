import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { badRequest, conflict } from '../../shared/errors/AppError.js';
import { validate } from '../../shared/validation/parse.js';
import { postSuccess } from '../ledger/service.js';
export const eventSchema = z.object({
    eventId: z.string().min(1).max(150), paymentId: z.string().uuid(),
    externalId: z.string().min(1).max(150), outcome: z.enum(['SUCCEEDED', 'FAILED'])
}).strict();
export type ProviderEvent = z.infer<typeof eventSchema>;
export function signWebhook(secret: string, body: Buffer | string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
export function verifyWebhook(secret: string, body: Buffer, signature: string | undefined): boolean {
    if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature))
        return false;
    const expected = Buffer.from(signWebhook(secret, body));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
}
/** Receipt and processing are separated. Processing locks the payment and event within one txn. */
export async function ingestEvent(db: PrismaClient, provider: string, value: unknown): Promise<'PROCESSED' | 'IGNORED'> {
    const payload = validate(eventSchema, value);
    let row;
    try {
        row = await db.webhookEvent.create({ data: { provider, ...payload, status: 'RECEIVED' } });
    }
    catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
            throw error;
        row = await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider, eventId: payload.eventId } } });
        if (row.paymentId !== payload.paymentId || row.externalId !== payload.externalId || row.outcome !== payload.outcome)
            throw conflict('Provider event identifier reused with different content');
    }
    if (row.status === 'PROCESSED' || row.status === 'IGNORED')
        return row.status;
    try {
        return await db.$transaction(async (tx) => {
            // locks serialize competing event deliveries, recovery, and outcome transitions.
            await tx.$queryRaw `SELECT id FROM "WebhookEvent" WHERE id = ${row.id} FOR UPDATE`;
            const currentEvent = await tx.webhookEvent.findUniqueOrThrow({ where: { id: row.id } });
            if (currentEvent.status === 'PROCESSED' || currentEvent.status === 'IGNORED')
                return currentEvent.status;
            const payment = await tx.payment.findUnique({ where: { id: payload.paymentId } });
            if (!payment)
                throw badRequest('Unknown payment reference');
            await tx.$queryRaw `SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
            const lockedPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
            const providerTxn = await tx.providerTransaction.findUnique({ where: { paymentId: payment.id } });
            if (!providerTxn || providerTxn.provider !== provider || providerTxn.externalId !== payload.externalId)
                throw badRequest('Provider transaction does not match payment');
            let status: 'PROCESSED' | 'IGNORED' = 'IGNORED';
            if (lockedPayment.status === 'PROCESSING') {
                const next = payload.outcome;
                const modified = await tx.payment.updateMany({ where: { id: payment.id, status: 'PROCESSING' }, data: { status: next } });
                if (modified.count !== 1)
                    throw conflict('Payment changed during provider event processing');
                await tx.providerTransaction.update({ where: { id: providerTxn.id }, data: { status: next } });
                if (next === 'SUCCEEDED')
                    await postSuccess(tx, lockedPayment);
                status = 'PROCESSED';
            }
            await tx.webhookEvent.update({ where: { id: row.id }, data: { status, attempts: { increment: 1 }, processedAt: new Date(), error: null } });
            return status;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 });
    }
    catch (error) {
        // A failed business transaction has rolled back. Persist a retryable failure state separately.
        await db.webhookEvent.updateMany({ where: { id: row.id, status: { in: ['RECEIVED', 'FAILED'] } }, data: { status: 'FAILED', attempts: { increment: 1 }, error: 'Processing failed' } });
        throw error;
    }
}
