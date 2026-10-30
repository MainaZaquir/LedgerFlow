import type { Payment, Prisma } from '@prisma/client';
import { badRequest } from '../../shared/errors/AppError.js';
export type DraftEntry = {
    account: 'PROVIDER_CLEARING' | 'MERCHANT_PAYABLE';
    side: 'DEBIT' | 'CREDIT';
    amount: bigint;
    currency: string;
};
export function assertBalanced(entries: readonly DraftEntry[]): void {
    if (entries.length < 2 || entries.some(e => e.amount <= 0n))
        throw badRequest('Ledger requires at least two positive entries');
    const currencies = new Set(entries.map(e => e.currency));
    if (currencies.size !== 1)
        throw badRequest('Mixed currencies not permitted in one posting');
    const debit = entries.filter(e => e.side === 'DEBIT').reduce((sum, e) => sum + e.amount, 0n);
    const credit = entries.filter(e => e.side === 'CREDIT').reduce((sum, e) => sum + e.amount, 0n);
    if (debit !== credit)
        throw badRequest('Ledger is unbalanced');
}
export async function postSuccess(db: Prisma.TransactionClient, payment: Payment): Promise<void> {
    if (payment.status !== 'PROCESSING')
        throw badRequest('Only processing payments may be posted as successful');
    const entries: DraftEntry[] = [
        { account: 'PROVIDER_CLEARING', side: 'DEBIT', amount: payment.amount, currency: payment.currency },
        { account: 'MERCHANT_PAYABLE', side: 'CREDIT', amount: payment.amount, currency: payment.currency }
    ];
    assertBalanced(entries);
    await db.ledgerTransaction.create({ data: {
            merchantId: payment.merchantId, paymentId: payment.id, postingKey: `PAYMENT:${payment.id}:SUCCESS`, currency: payment.currency,
            entries: { create: entries }
        } });
}
