-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('STANDARD', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "ShareDocType" AS ENUM ('QUOTE', 'INVOICE');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "priceListId" UUID;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "deductedInId" UUID,
ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "recurringId" UUID,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "respondedByName" TEXT,
ADD COLUMN     "responseNote" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "docType" "ShareDocType" NOT NULL,
    "docId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDispatch" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "docType" "ShareDocType" NOT NULL,
    "docId" UUID NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL,
    "error" TEXT,
    "sentById" UUID,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoice" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "nextRunDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "autoIssue" BOOLEAN NOT NULL DEFAULT false,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "terms" TEXT,
    "lines" JSONB NOT NULL,
    "branchId" UUID,
    "costCenterId" UUID,
    "projectId" UUID,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_companyId_docType_docId_key" ON "ShareLink"("companyId", "docType", "docId");

-- CreateIndex
CREATE INDEX "DocumentDispatch_companyId_docType_docId_idx" ON "DocumentDispatch"("companyId", "docType", "docId");

-- CreateIndex
CREATE INDEX "RecurringInvoice_companyId_status_nextRunDate_idx" ON "RecurringInvoice"("companyId", "status", "nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringInvoice_companyId_customerId_idx" ON "RecurringInvoice"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_companyId_name_key" ON "PriceList"("companyId", "name");

-- CreateIndex
CREATE INDEX "PriceListItem_companyId_productId_idx" ON "PriceListItem"("companyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_key" ON "PriceListItem"("priceListId", "productId");

-- CreateIndex
CREATE INDEX "Customer_companyId_priceListId_idx" ON "Customer"("companyId", "priceListId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_quoteId_idx" ON "Invoice"("companyId", "quoteId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_deductedInId_idx" ON "Invoice"("companyId", "deductedInId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_recurringId_idx" ON "Invoice"("companyId", "recurringId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation par entreprise (RLS) des nouvelles tables
SELECT afg_enable_rls('"ShareLink"');
SELECT afg_enable_rls('"DocumentDispatch"');
SELECT afg_enable_rls('"RecurringInvoice"');
SELECT afg_enable_rls('"PriceList"');
SELECT afg_enable_rls('"PriceListItem"');
