CREATE TYPE "PaymentStatus" AS ENUM ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED');
CREATE TYPE "ProviderStatus" AS ENUM ('UNKNOWN','ACCEPTED','SUCCEEDED','FAILED');
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED','PROCESSED','IGNORED','FAILED');
CREATE TYPE "PostingSide" AS ENUM ('DEBIT','CREDIT');
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED','MISSING_PROVIDER','MISSING_INTERNAL','AMOUNT_MISMATCH','CURRENCY_MISMATCH','STATUS_MISMATCH','DUPLICATE_PROVIDER','AMBIGUOUS');
CREATE TABLE "Merchant" (
  "id" TEXT PRIMARY KEY,"slug" TEXT NOT NULL UNIQUE,"name" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ApiKey" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),"label" TEXT NOT NULL,
  "hash" TEXT NOT NULL UNIQUE,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"revokedAt" TIMESTAMP(3)
);
CREATE INDEX "ApiKey_merchantId_idx" ON "ApiKey"("merchantId");
CREATE TABLE "Payment" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),"amount" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,"status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "description" VARCHAR(200),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0 AND "amount" <= 1000000000000),
  CONSTRAINT "Payment_currency_valid" CHECK ("currency" IN ('KES','USD','JPY','KWD'))
);
CREATE INDEX "Payment_merchantId_createdAt_id_idx" ON "Payment"("merchantId","createdAt","id");
CREATE TABLE "ProviderTransaction" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),
  "paymentId" TEXT NOT NULL UNIQUE REFERENCES "Payment"("id"),
  "provider" TEXT NOT NULL,"externalId" TEXT NOT NULL,"status" "ProviderStatus" NOT NULL DEFAULT 'UNKNOWN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderTransaction_provider_externalId_key" UNIQUE("provider","externalId")
);
CREATE INDEX "ProviderTransaction_merchantId_provider_idx" ON "ProviderTransaction"("merchantId","provider");
CREATE TABLE "IdempotencyRecord" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),
  "operation" TEXT NOT NULL,"key" VARCHAR(128) NOT NULL,"fingerprint" VARCHAR(64) NOT NULL,
  "paymentId" TEXT NOT NULL REFERENCES "Payment"("id"),"statusCode" INTEGER NOT NULL DEFAULT 201,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_merchantId_operation_key_key" UNIQUE("merchantId","operation","key")
);
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");
CREATE TABLE "WebhookEvent" (
  "id" TEXT PRIMARY KEY,"provider" TEXT NOT NULL,"eventId" TEXT NOT NULL,"paymentId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,"outcome" TEXT NOT NULL,"status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,"error" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"processedAt" TIMESTAMP(3),
  CONSTRAINT "WebhookEvent_provider_eventId_key" UNIQUE("provider","eventId")
);
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status","receivedAt");
CREATE TABLE "LedgerTransaction" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),
  "paymentId" TEXT NOT NULL UNIQUE REFERENCES "Payment"("id"),"postingKey" TEXT NOT NULL UNIQUE,
  "currency" VARCHAR(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LedgerTransaction_merchantId_createdAt_idx" ON "LedgerTransaction"("merchantId","createdAt");
CREATE TABLE "LedgerEntry" (
  "id" TEXT PRIMARY KEY,"transactionId" TEXT NOT NULL REFERENCES "LedgerTransaction"("id"),
  "account" TEXT NOT NULL,"side" "PostingSide" NOT NULL,"amount" BIGINT NOT NULL,"currency" VARCHAR(3) NOT NULL,
  CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "LedgerEntry_account_valid" CHECK ("account" IN ('PROVIDER_CLEARING','MERCHANT_PAYABLE'))
);
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");
CREATE TABLE "ReconciliationImport" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),"provider" TEXT NOT NULL,
  "filename" VARCHAR(200) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReconciliationImport_merchantId_createdAt_idx" ON "ReconciliationImport"("merchantId","createdAt");
CREATE TABLE "ProviderReportRow" (
  "id" TEXT PRIMARY KEY,"importId" TEXT NOT NULL REFERENCES "ReconciliationImport"("id"),
  "lineNumber" INTEGER NOT NULL,"externalId" TEXT NOT NULL,"amount" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,"status" "ProviderStatus" NOT NULL,"occurredAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderReportRow_importId_lineNumber_key" UNIQUE("importId","lineNumber"),
  CONSTRAINT "ProviderReportRow_amount_positive" CHECK ("amount" > 0 AND "amount" <= 1000000000000),
  CONSTRAINT "ProviderReportRow_currency_valid" CHECK ("currency" IN ('KES','USD','JPY','KWD'))
);
CREATE INDEX "ProviderReportRow_importId_externalId_idx" ON "ProviderReportRow"("importId","externalId");
CREATE TABLE "ReconciliationRun" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),
  "importId" TEXT NOT NULL REFERENCES "ReconciliationImport"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReconciliationRun_merchantId_importId_key" UNIQUE("merchantId","importId")
);
CREATE INDEX "ReconciliationRun_merchantId_createdAt_idx" ON "ReconciliationRun"("merchantId","createdAt");
CREATE TABLE "ReconciliationItem" (
  "id" TEXT PRIMARY KEY,"runId" TEXT NOT NULL REFERENCES "ReconciliationRun"("id"),
  "paymentId" TEXT REFERENCES "Payment"("id"),"reportRowId" TEXT REFERENCES "ProviderReportRow"("id"),
  "externalId" TEXT NOT NULL,"status" "ReconciliationStatus" NOT NULL,
  "detail" TEXT NOT NULL,"resolution" VARCHAR(500),"resolvedAt" TIMESTAMP(3)
);
CREATE INDEX "ReconciliationItem_runId_status_idx" ON "ReconciliationItem"("runId","status");
CREATE INDEX "ReconciliationItem_paymentId_idx" ON "ReconciliationItem"("paymentId");
CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY,"merchantId" TEXT NOT NULL REFERENCES "Merchant"("id"),
  "action" TEXT NOT NULL,"targetId" TEXT NOT NULL,"detail" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId","createdAt");
-- Only ledger posting service can insert. Even privileged ORM operations cannot mutate posted history.
CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Posted ledger data is immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
