-- CreateEnum
CREATE TYPE "AdvanceKind" AS ENUM ('ADVANCE', 'ACOMPTE');

-- CreateEnum
CREATE TYPE "RepaymentSource" AS ENUM ('MANUAL', 'PAYROLL');

-- CreateEnum
CREATE TYPE "DisciplineStatus" AS ENUM ('OPEN', 'DECIDED', 'NOTIFIED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisciplineStepKind" AS ENUM ('FACTS_REPORT', 'EXPLANATION_REQUEST', 'CONVOCATION', 'HEARING', 'DECISION', 'NOTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicalVisitKind" AS ENUM ('HIRING', 'PERIODIC', 'RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicalVisitStatus" AS ENUM ('PLANNED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EquipmentCondition" AS ENUM ('NEW', 'GOOD', 'WORN', 'DAMAGED');

-- AlterTable
ALTER TABLE "HrSettings" ADD COLUMN     "equipmentAlertDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "visitReminderDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "OvertimeRate" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "multiplier" DECIMAL(5,2) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeRecord" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "normalHours" DECIMAL(5,2) NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "approvedHours" DECIMAL(5,2),
    "rateId" UUID,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "AdvanceKind" NOT NULL DEFAULT 'ADVANCE',
    "amount" DECIMAL(18,2) NOT NULL,
    "requestDate" DATE NOT NULL,
    "reason" TEXT,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "firstDeductionMonth" DATE NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceRepayment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "advanceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "source" "RepaymentSource" NOT NULL DEFAULT 'MANUAL',
    "period" TEXT,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanctionType" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "requiresHearing" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SanctionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplinaryCase" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "employeeId" UUID NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "factsDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "breachNature" TEXT NOT NULL,
    "procedureNote" TEXT,
    "sanctionTypeId" UUID,
    "decisionDate" DATE,
    "notificationDate" DATE,
    "responsibleName" TEXT,
    "observations" TEXT,
    "status" "DisciplineStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplinaryCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplinaryStep" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "kind" "DisciplineStepKind" NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisciplinaryStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalVisit" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "MedicalVisitKind" NOT NULL,
    "scheduledOn" DATE,
    "doneOn" DATE,
    "provider" TEXT,
    "nextDueOn" DATE,
    "aptitudeDoc" "JustificationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "status" "MedicalVisitStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentAssignment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "issuedOn" DATE NOT NULL,
    "condition" "EquipmentCondition" NOT NULL DEFAULT 'NEW',
    "replaceOn" DATE,
    "returnedOn" DATE,
    "returnCondition" "EquipmentCondition",
    "responsibleName" TEXT,
    "observations" TEXT,
    "productId" UUID,
    "warehouseId" UUID,
    "issueMovementId" UUID,
    "returnMovementId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeRate_companyId_name_key" ON "OvertimeRate"("companyId", "name");

-- CreateIndex
CREATE INDEX "OvertimeRecord_companyId_employeeId_date_idx" ON "OvertimeRecord"("companyId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "OvertimeRecord_companyId_status_idx" ON "OvertimeRecord"("companyId", "status");

-- CreateIndex
CREATE INDEX "OvertimeRecord_companyId_rateId_idx" ON "OvertimeRecord"("companyId", "rateId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_companyId_employeeId_requestDate_idx" ON "SalaryAdvance"("companyId", "employeeId", "requestDate");

-- CreateIndex
CREATE INDEX "SalaryAdvance_companyId_status_idx" ON "SalaryAdvance"("companyId", "status");

-- CreateIndex
CREATE INDEX "AdvanceRepayment_companyId_advanceId_idx" ON "AdvanceRepayment"("companyId", "advanceId");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceRepayment_advanceId_period_key" ON "AdvanceRepayment"("advanceId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "SanctionType_companyId_name_key" ON "SanctionType"("companyId", "name");

-- CreateIndex
CREATE INDEX "DisciplinaryCase_companyId_employeeId_factsDate_idx" ON "DisciplinaryCase"("companyId", "employeeId", "factsDate");

-- CreateIndex
CREATE INDEX "DisciplinaryCase_companyId_status_idx" ON "DisciplinaryCase"("companyId", "status");

-- CreateIndex
CREATE INDEX "DisciplinaryCase_companyId_sanctionTypeId_idx" ON "DisciplinaryCase"("companyId", "sanctionTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "DisciplinaryCase_companyId_number_key" ON "DisciplinaryCase"("companyId", "number");

-- CreateIndex
CREATE INDEX "DisciplinaryStep_companyId_caseId_date_idx" ON "DisciplinaryStep"("companyId", "caseId", "date");

-- CreateIndex
CREATE INDEX "MedicalVisit_companyId_employeeId_scheduledOn_idx" ON "MedicalVisit"("companyId", "employeeId", "scheduledOn");

-- CreateIndex
CREATE INDEX "MedicalVisit_companyId_status_scheduledOn_idx" ON "MedicalVisit"("companyId", "status", "scheduledOn");

-- CreateIndex
CREATE INDEX "MedicalVisit_companyId_nextDueOn_idx" ON "MedicalVisit"("companyId", "nextDueOn");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_companyId_employeeId_issuedOn_idx" ON "EquipmentAssignment"("companyId", "employeeId", "issuedOn");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_companyId_replaceOn_idx" ON "EquipmentAssignment"("companyId", "replaceOn");

-- AddForeignKey
ALTER TABLE "OvertimeRate" ADD CONSTRAINT "OvertimeRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_rateId_fkey" FOREIGN KEY ("rateId") REFERENCES "OvertimeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "SalaryAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionType" ADD CONSTRAINT "SanctionType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryCase" ADD CONSTRAINT "DisciplinaryCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryCase" ADD CONSTRAINT "DisciplinaryCase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryCase" ADD CONSTRAINT "DisciplinaryCase_sanctionTypeId_fkey" FOREIGN KEY ("sanctionTypeId") REFERENCES "SanctionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryStep" ADD CONSTRAINT "DisciplinaryStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryStep" ADD CONSTRAINT "DisciplinaryStep_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DisciplinaryCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalVisit" ADD CONSTRAINT "MedicalVisit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalVisit" ADD CONSTRAINT "MedicalVisit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cohérence
ALTER TABLE "OvertimeRate" ADD CONSTRAINT "OvertimeRate_multiplier_check" CHECK ("multiplier" > 0);
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_hours_check" CHECK ("hours" > 0 AND "normalHours" >= 0 AND ("approvedHours" IS NULL OR ("approvedHours" >= 0 AND "approvedHours" <= "hours")));
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_amount_check" CHECK ("amount" > 0 AND "installments" >= 1);
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_quantity_check" CHECK ("quantity" > 0 AND ("returnedOn" IS NULL OR "returnedOn" >= "issuedOn"));

-- Isolation par entreprise (RLS)
SELECT afg_enable_rls('"OvertimeRate"');
SELECT afg_enable_rls('"OvertimeRecord"');
SELECT afg_enable_rls('"SalaryAdvance"');
SELECT afg_enable_rls('"AdvanceRepayment"');
SELECT afg_enable_rls('"SanctionType"');
SELECT afg_enable_rls('"DisciplinaryCase"');
SELECT afg_enable_rls('"DisciplinaryStep"');
SELECT afg_enable_rls('"MedicalVisit"');
SELECT afg_enable_rls('"EquipmentAssignment"');
