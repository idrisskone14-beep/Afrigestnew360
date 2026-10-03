-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "headers" JSONB NOT NULL,
    "rows" JSONB,
    "rowCount" INTEGER NOT NULL,
    "mapping" JSONB,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_companyId_createdAt_idx" ON "ImportJob"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Intégrité et isolation
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_counts_check" CHECK ("rowCount" >= 0 AND "validCount" >= 0 AND "errorCount" >= 0 AND "ignoredCount" >= 0 AND "createdCount" >= 0 AND "failedCount" >= 0);
SELECT afg_enable_rls('"ImportJob"');
