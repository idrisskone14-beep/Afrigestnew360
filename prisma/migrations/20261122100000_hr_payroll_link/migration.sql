-- CreateEnum
CREATE TYPE "PayrollHrLinkKind" AS ENUM ('OVERTIME', 'ADVANCE');

-- AlterTable
ALTER TABLE "AbsenceType" ADD COLUMN     "deductFromPay" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OvertimeRecord" ADD COLUMN     "payrollPeriod" TEXT;

-- AlterTable
ALTER TABLE "HrSettings" ADD COLUMN     "payrollAdvances" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payrollMonthlyHours" DECIMAL(6,2),
ADD COLUMN     "payrollOvertime" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payrollUnpaidAbsences" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payrollUnpaidTimeOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PayrollHrLink" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "PayrollHrLinkKind" NOT NULL,
    "refId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "hours" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollHrLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollHrLink_companyId_runId_idx" ON "PayrollHrLink"("companyId", "runId");

-- CreateIndex
CREATE INDEX "PayrollHrLink_companyId_kind_refId_idx" ON "PayrollHrLink"("companyId", "kind", "refId");

-- AddForeignKey
ALTER TABLE "PayrollHrLink" ADD CONSTRAINT "PayrollHrLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollHrLink" ADD CONSTRAINT "PayrollHrLink_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "PayrollHrLink" ADD CONSTRAINT "PayrollHrLink_amount_check" CHECK ("amount" >= 0);

-- Isolation par entreprise (RLS)
SELECT afg_enable_rls('"PayrollHrLink"');
