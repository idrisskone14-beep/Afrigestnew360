-- Registre FNE : documents certifiés par la DGI, importés depuis l'export de l'espace FNE (suivi du chiffre d'affaires).
-- Migration additive : une table et un type, rien n'est modifié dans l'existant.

-- CreateEnum
CREATE TYPE "FneDocKind" AS ENUM ('INVOICE', 'REFUND', 'PROFORMA');

-- CreateTable
CREATE TABLE "FneRegistryEntry" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "FneDocKind" NOT NULL,
    "initialReference" TEXT,
    "token" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "template" TEXT,
    "taxRegime" TEXT,
    "totalHt" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalVat" DECIMAL(18,2) NOT NULL,
    "totalTtc" DECIMAL(18,2) NOT NULL,
    "otherTaxes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netToPay" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "customerName" TEXT NOT NULL,
    "customerNcc" TEXT,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "seller" TEXT,
    "establishment" TEXT,
    "pointOfSale" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FneRegistryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FneRegistryEntry_companyId_issuedAt_idx" ON "FneRegistryEntry"("companyId", "issuedAt");

-- CreateIndex
CREATE INDEX "FneRegistryEntry_companyId_customerNcc_idx" ON "FneRegistryEntry"("companyId", "customerNcc");

-- CreateIndex
CREATE UNIQUE INDEX "FneRegistryEntry_companyId_reference_key" ON "FneRegistryEntry"("companyId", "reference");

-- AddForeignKey
ALTER TABLE "FneRegistryEntry" ADD CONSTRAINT "FneRegistryEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation multi-tenant
SELECT afg_enable_rls('"FneRegistryEntry"');
