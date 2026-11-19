-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JustificationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROVIDED', 'ACCEPTED', 'REFUSED');

-- CreateEnum
CREATE TYPE "AccidentKind" AS ENUM ('WORKPLACE', 'COMMUTE', 'MISSION');

-- CreateEnum
CREATE TYPE "AccidentStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CnpsDeclarationStatus" AS ENUM ('NOT_REQUIRED', 'TO_DECLARE', 'DECLARED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "AccidentQualification" AS ENUM ('TO_QUALIFY', 'RECOGNIZED', 'NOT_RECOGNIZED');

-- CreateEnum
CREATE TYPE "TimeOffUnit" AS ENUM ('HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "AbsenceCategory" AS ENUM ('JUSTIFIED', 'UNJUSTIFIED', 'SICK', 'EXCEPTIONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LatenessSource" AS ENUM ('MANUAL', 'ATTENDANCE');

-- AlterTable
ALTER TABLE "HrSettings" ADD COLUMN     "absenceRepeatCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "absenceRepeatDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "accidentDeclarationDays" INTEGER,
ADD COLUMN     "breakEndTime" TEXT,
ADD COLUMN     "breakStartTime" TEXT,
ADD COLUMN     "lateGraceMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateRecurrenceCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "lateRecurrenceDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "workEndTime" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "workStartTime" TEXT NOT NULL DEFAULT '08:00';

-- CreateTable
CREATE TABLE "WorkAccident" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "employeeId" UUID NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "departmentName" TEXT,
    "kind" "AccidentKind" NOT NULL DEFAULT 'WORKPLACE',
    "occurredOn" DATE NOT NULL,
    "occurredTime" TEXT,
    "place" TEXT NOT NULL,
    "category" TEXT,
    "circumstances" TEXT NOT NULL,
    "injuries" TEXT,
    "witnesses" TEXT,
    "firstAid" TEXT,
    "careFacility" TEXT,
    "commuteDetails" TEXT,
    "workStop" BOOLEAN NOT NULL DEFAULT false,
    "stopStart" DATE,
    "stopEnd" DATE,
    "returnDate" DATE,
    "cnpsStatus" "CnpsDeclarationStatus" NOT NULL DEFAULT 'TO_DECLARE',
    "cnpsDeclaredOn" DATE,
    "cnpsReference" TEXT,
    "qualification" "AccidentQualification" NOT NULL DEFAULT 'TO_QUALIFY',
    "correctiveActions" TEXT,
    "status" "AccidentStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkAccident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOffType" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "requiresProof" BOOLEAN NOT NULL DEFAULT false,
    "maxDays" DECIMAL(5,1),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeOffType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOffRequest" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "unit" "TimeOffUnit" NOT NULL,
    "startDate" DATE NOT NULL,
    "startTime" TEXT,
    "endDate" DATE NOT NULL,
    "endTime" TEXT,
    "days" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceType" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AbsenceCategory" NOT NULL DEFAULT 'OTHER',
    "requiresValidation" BOOLEAN NOT NULL DEFAULT false,
    "requiresProof" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceRecord" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "justification" "JustificationStatus" NOT NULL DEFAULT 'PENDING',
    "hrNote" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'APPROVED',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbsenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LatenessRecord" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "expectedTime" TEXT NOT NULL,
    "actualTime" TEXT NOT NULL,
    "minutesLate" INTEGER NOT NULL,
    "reason" TEXT,
    "justification" "JustificationStatus" NOT NULL DEFAULT 'PENDING',
    "hrNote" TEXT,
    "source" "LatenessSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LatenessRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkAccident_companyId_employeeId_occurredOn_idx" ON "WorkAccident"("companyId", "employeeId", "occurredOn");

-- CreateIndex
CREATE INDEX "WorkAccident_companyId_status_occurredOn_idx" ON "WorkAccident"("companyId", "status", "occurredOn");

-- CreateIndex
CREATE INDEX "WorkAccident_companyId_cnpsStatus_idx" ON "WorkAccident"("companyId", "cnpsStatus");

-- CreateIndex
CREATE UNIQUE INDEX "WorkAccident_companyId_number_key" ON "WorkAccident"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TimeOffType_companyId_name_key" ON "TimeOffType"("companyId", "name");

-- CreateIndex
CREATE INDEX "TimeOffRequest_companyId_employeeId_startDate_idx" ON "TimeOffRequest"("companyId", "employeeId", "startDate");

-- CreateIndex
CREATE INDEX "TimeOffRequest_companyId_status_idx" ON "TimeOffRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "TimeOffRequest_companyId_typeId_idx" ON "TimeOffRequest"("companyId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceType_companyId_name_key" ON "AbsenceType"("companyId", "name");

-- CreateIndex
CREATE INDEX "AbsenceRecord_companyId_employeeId_startDate_idx" ON "AbsenceRecord"("companyId", "employeeId", "startDate");

-- CreateIndex
CREATE INDEX "AbsenceRecord_companyId_status_idx" ON "AbsenceRecord"("companyId", "status");

-- CreateIndex
CREATE INDEX "AbsenceRecord_companyId_typeId_idx" ON "AbsenceRecord"("companyId", "typeId");

-- CreateIndex
CREATE INDEX "LatenessRecord_companyId_date_idx" ON "LatenessRecord"("companyId", "date");

-- CreateIndex
CREATE INDEX "LatenessRecord_companyId_employeeId_date_idx" ON "LatenessRecord"("companyId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LatenessRecord_employeeId_date_key" ON "LatenessRecord"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "WorkAccident" ADD CONSTRAINT "WorkAccident_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAccident" ADD CONSTRAINT "WorkAccident_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOffType" ADD CONSTRAINT "TimeOffType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOffRequest" ADD CONSTRAINT "TimeOffRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOffRequest" ADD CONSTRAINT "TimeOffRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOffRequest" ADD CONSTRAINT "TimeOffRequest_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TimeOffType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceType" ADD CONSTRAINT "AbsenceType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRecord" ADD CONSTRAINT "AbsenceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRecord" ADD CONSTRAINT "AbsenceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRecord" ADD CONSTRAINT "AbsenceRecord_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AbsenceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatenessRecord" ADD CONSTRAINT "LatenessRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatenessRecord" ADD CONSTRAINT "LatenessRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cohérence des dates et des durées (en plus des contrôles du serveur)
ALTER TABLE "WorkAccident" ADD CONSTRAINT "WorkAccident_stop_dates_check" CHECK ("stopEnd" IS NULL OR "stopStart" IS NULL OR "stopEnd" >= "stopStart");
ALTER TABLE "TimeOffRequest" ADD CONSTRAINT "TimeOffRequest_dates_check" CHECK ("endDate" >= "startDate" AND "days" >= 0 AND "hours" >= 0);
ALTER TABLE "AbsenceRecord" ADD CONSTRAINT "AbsenceRecord_dates_check" CHECK ("endDate" >= "startDate" AND "days" > 0);
ALTER TABLE "LatenessRecord" ADD CONSTRAINT "LatenessRecord_minutes_check" CHECK ("minutesLate" > 0);

-- Isolation par entreprise (RLS)
SELECT afg_enable_rls('"WorkAccident"');
SELECT afg_enable_rls('"TimeOffType"');
SELECT afg_enable_rls('"TimeOffRequest"');
SELECT afg_enable_rls('"AbsenceType"');
SELECT afg_enable_rls('"AbsenceRecord"');
SELECT afg_enable_rls('"LatenessRecord"');
