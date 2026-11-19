-- Facture normalisée électronique (FNE, DGI Côte d'Ivoire) : certification des factures et avoirs par API.
-- Migration additive : colonnes facultatives et une table de réglages par entreprise.

-- CreateEnum
CREATE TYPE "FneStatus" AS ENUM ('PENDING', 'CERTIFIED', 'FAILED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "fneStatus" "FneStatus",
ADD COLUMN     "fneReference" TEXT,
ADD COLUMN     "fneVerifyUrl" TEXT,
ADD COLUMN     "fneId" TEXT,
ADD COLUMN     "fneItems" JSONB,
ADD COLUMN     "fneTemplate" TEXT,
ADD COLUMN     "fnePaymentMethod" TEXT,
ADD COLUMN     "fneError" TEXT,
ADD COLUMN     "fneAttemptAt" TIMESTAMP(3),
ADD COLUMN     "fneCertifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "fneStatus" "FneStatus",
ADD COLUMN     "fneReference" TEXT,
ADD COLUMN     "fneVerifyUrl" TEXT,
ADD COLUMN     "fneError" TEXT,
ADD COLUMN     "fneAttemptAt" TIMESTAMP(3),
ADD COLUMN     "fneCertifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FneSettings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'test',
    "apiKeyEnc" TEXT,
    "apiKeyHint" TEXT,
    "pointOfSale" TEXT,
    "establishment" TEXT,
    "commercialMessage" TEXT,
    "footer" TEXT,
    "autoCertify" BOOLEAN NOT NULL DEFAULT true,
    "exemptTaxCode" TEXT NOT NULL DEFAULT 'TVAD',
    "stickerBalance" INTEGER,
    "stickerWarning" BOOLEAN NOT NULL DEFAULT false,
    "stickerCheckedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FneSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FneSettings_companyId_key" ON "FneSettings"("companyId");

-- AddForeignKey
ALTER TABLE "FneSettings" ADD CONSTRAINT "FneSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation multi-tenant
SELECT afg_enable_rls('"FneSettings"');
