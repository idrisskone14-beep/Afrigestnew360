-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'LOCKED');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('SALES', 'PURCHASES', 'BANK', 'CASH', 'MISC', 'OPENING');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('DRAFT', 'POSTED');

-- AlterTable
ALTER TABLE "FinanceCategory" ADD COLUMN     "ledgerCode" TEXT;

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fiscalYearId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "JournalType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMapping" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "ledgerAccountId" UUID NOT NULL,

    CONSTRAINT "AccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "journalId" UUID NOT NULL,
    "fiscalYearId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT,
    "sourceId" UUID,
    "reversalOfId" UUID,
    "createdById" UUID,
    "postedById" UUID,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "ledgerAccountId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "partyType" TEXT,
    "partyId" UUID,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalYear_companyId_startDate_idx" ON "FiscalYear"("companyId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_companyId_name_key" ON "FiscalYear"("companyId", "name");

-- CreateIndex
CREATE INDEX "AccountingPeriod_companyId_startDate_idx" ON "AccountingPeriod"("companyId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_fiscalYearId_startDate_key" ON "AccountingPeriod"("fiscalYearId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_companyId_code_key" ON "Journal"("companyId", "code");

-- CreateIndex
CREATE INDEX "LedgerAccount_companyId_class_idx" ON "LedgerAccount"("companyId", "class");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_companyId_code_key" ON "LedgerAccount"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_companyId_key_key" ON "AccountMapping"("companyId", "key");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_date_idx" ON "JournalEntry"("companyId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_journalId_date_idx" ON "JournalEntry"("companyId", "journalId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_number_key" ON "JournalEntry"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_sourceType_sourceId_key" ON "JournalEntry"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalLine_companyId_ledgerAccountId_idx" ON "JournalLine"("companyId", "ledgerAccountId");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Intégrité comptable ──────────────────────────────────────
-- Une ligne est soit au débit, soit au crédit, jamais négative.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amounts_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0));

-- Une écriture validée est immuable (ni modification, ni suppression, ni ligne ajoutée) : on la corrige par contre-passation.
-- Seul le contexte plateforme (app.bypass_rls) peut supprimer, pour la suppression d'une entreprise entière.
CREATE OR REPLACE FUNCTION afg_protect_posted_entry() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  entry_status text;
  target_entry uuid;
BEGIN
  IF current_setting('app.bypass_rls', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'JournalEntry' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'Une écriture comptable validée est immuable (utilisez une contre-passation).' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN target_entry := NEW."entryId"; ELSE target_entry := OLD."entryId"; END IF;
    SELECT status::text INTO entry_status FROM "JournalEntry" WHERE id = target_entry;
    IF entry_status = 'POSTED' THEN
      RAISE EXCEPTION 'Une écriture comptable validée est immuable (utilisez une contre-passation).' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER "JournalEntry_immutable" BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION afg_protect_posted_entry();
CREATE TRIGGER "JournalLine_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION afg_protect_posted_entry();

-- RLS (isolation multi-tenant)
SELECT afg_enable_rls('"FiscalYear"');
SELECT afg_enable_rls('"AccountingPeriod"');
SELECT afg_enable_rls('"Journal"');
SELECT afg_enable_rls('"LedgerAccount"');
SELECT afg_enable_rls('"AccountMapping"');
SELECT afg_enable_rls('"JournalEntry"');
SELECT afg_enable_rls('"JournalLine"');
