-- CreateEnum
CREATE TYPE "PayrollItemType" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER');

-- CreateEnum
CREATE TYPE "PayrollCalcMode" AS ENUM ('FIXED', 'RATE', 'BRACKETS');

-- CreateEnum
CREATE TYPE "PayrollBase" AS ENUM ('BASE', 'GROSS', 'TAXABLE');

-- CreateEnum
CREATE TYPE "PayrollCategory" AS ENUM ('SOCIAL', 'TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PayrollItemType" NOT NULL,
    "category" "PayrollCategory" NOT NULL DEFAULT 'OTHER',
    "mode" "PayrollCalcMode" NOT NULL,
    "base" "PayrollBase" NOT NULL DEFAULT 'GROSS',
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ceiling" DECIMAL(18,2),
    "brackets" JSONB,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "deductibleForTax" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayrollItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PayrollItemType" NOT NULL,
    "category" "PayrollCategory" NOT NULL DEFAULT 'OTHER',
    "amount" DECIMAL(18,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeePayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "totalGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "accountId" UUID,
    "calculatedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" UUID,
    "paidAt" TIMESTAMP(3),
    "paidById" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "number" TEXT,
    "baseSalary" DECIMAL(18,2) NOT NULL,
    "prorata" DECIMAL(7,6) NOT NULL DEFAULT 1,
    "unpaidDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "gross" DECIMAL(18,2) NOT NULL,
    "taxableGross" DECIMAL(18,2) NOT NULL,
    "totalDeductions" DECIMAL(18,2) NOT NULL,
    "netPay" DECIMAL(18,2) NOT NULL,
    "employerCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(18,2) NOT NULL,
    "payoutMethod" TEXT,
    "payoutReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "payslipId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "PayrollItemType" NOT NULL,
    "category" "PayrollCategory" NOT NULL DEFAULT 'OTHER',
    "base" DECIMAL(18,2),
    "rate" DECIMAL(9,4),
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollItem_companyId_isActive_idx" ON "PayrollItem"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_companyId_code_effectiveFrom_key" ON "PayrollItem"("companyId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeePayrollItem_companyId_employeeId_idx" ON "EmployeePayrollItem"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollRun_companyId_year_month_idx" ON "PayrollRun"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "Payslip_companyId_employeeId_idx" ON "Payslip"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_companyId_number_key" ON "Payslip"("companyId", "number");

-- CreateIndex
CREATE INDEX "PayslipLine_payslipId_idx" ON "PayslipLine"("payslipId");

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollItem" ADD CONSTRAINT "EmployeePayrollItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollItem" ADD CONSTRAINT "EmployeePayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Une seule campagne de paie active par mois (une campagne annulée n'empêche pas d'en refaire une)
CREATE UNIQUE INDEX "PayrollRun_company_period_active_key" ON "PayrollRun" ("companyId", "year", "month") WHERE "status" <> 'CANCELLED';
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_month_check" CHECK ("month" BETWEEN 1 AND 12);

-- RLS (isolation multi-tenant)
SELECT afg_enable_rls('"PayrollItem"');
SELECT afg_enable_rls('"EmployeePayrollItem"');
SELECT afg_enable_rls('"PayrollRun"');
SELECT afg_enable_rls('"Payslip"');
SELECT afg_enable_rls('"PayslipLine"');
