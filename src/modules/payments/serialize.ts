import type { Payment, ProviderTransaction } from '@prisma/client';
export function serializePayment(payment: Payment & {
    providerTxn?: ProviderTransaction | null;
}) {
    return { id: payment.id, amount: payment.amount.toString(), currency: payment.currency,
        status: payment.status, description: payment.description, providerTransactionId: payment.providerTxn?.externalId ?? null,
        createdAt: payment.createdAt.toISOString(), updatedAt: payment.updatedAt.toISOString() };
}
