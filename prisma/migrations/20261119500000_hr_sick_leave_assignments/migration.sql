-- CreateEnum
CREATE TYPE "SickLeaveStatus" AS ENUM ('ONGOING', 'ENDED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "professionalCategory" TEXT;

-- AlterTable
ALTER TABLE "HrSettings" ADD COLUMN     "sickReturnAlertDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "SickLeave" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "expectedEndDate" DATE NOT NULL,
    "returnDate" DATE,
    "certificate" "JustificationStatus" NOT NULL DEFAULT 'PENDING',
    "observations" TEXT,
    "status" "SickLeaveStatus" NOT NULL DEFAULT 'ONGOING',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SickLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SickLeaveExtension" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "sickLeaveId" UUID NOT NULL,
    "previousEnd" DATE NOT NULL,
    "newEnd" DATE NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SickLeaveExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAssignment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "jobTitle" TEXT,
    "departmentId" UUID,
    "departmentName" TEXT,
    "branchId" UUID,
    "branchName" TEXT,
    "managerId" UUID,
    "managerName" TEXT,
    "reason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SickLeave_companyId_employeeId_startDate_idx" ON "SickLeave"("companyId", "employeeId", "startDate");

-- CreateIndex
CREATE INDEX "SickLeave_companyId_status_idx" ON "SickLeave"("companyId", "status");

-- CreateIndex
CREATE INDEX "SickLeaveExtension_companyId_sickLeaveId_idx" ON "SickLeaveExtension"("companyId", "sickLeaveId");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_companyId_employeeId_effectiveDate_idx" ON "EmployeeAssignment"("companyId", "employeeId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickLeaveExtension" ADD CONSTRAINT "SickLeaveExtension_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickLeaveExtension" ADD CONSTRAINT "SickLeaveExtension_sickLeaveId_fkey" FOREIGN KEY ("sickLeaveId") REFERENCES "SickLeave"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cohérence des dates
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_dates_check" CHECK ("expectedEndDate" >= "startDate" AND ("returnDate" IS NULL OR "returnDate" > "startDate"));
ALTER TABLE "SickLeaveExtension" ADD CONSTRAINT "SickLeaveExtension_dates_check" CHECK ("newEnd" > "previousEnd");

-- Historique initial des affectations : une ligne par salarié, d'après sa fiche actuelle (aucune donnée inventée). Avant l'activation de la RLS.
INSERT INTO "EmployeeAssignment" ("id", "companyId", "employeeId", "effectiveDate", "jobTitle", "departmentId", "departmentName", "branchId", "branchName", "managerId", "managerName", "reason")
SELECT gen_random_uuid(), e."companyId", e."id", e."hireDate", e."jobTitle", e."departmentId", d."name", e."branchId", b."name", e."managerId", NULLIF(TRIM(COALESCE(m."lastName", '') || ' ' || COALESCE(m."firstName", '')), ''), 'Situation à la mise en service de l''historique'
FROM "Employee" e
LEFT JOIN "Department" d ON d."id" = e."departmentId"
LEFT JOIN "Branch" b ON b."id" = e."branchId"
LEFT JOIN "Employee" m ON m."id" = e."managerId"
WHERE e."deletedAt" IS NULL;

-- Isolation par entreprise (RLS)
SELECT afg_enable_rls('"SickLeave"');
SELECT afg_enable_rls('"SickLeaveExtension"');
SELECT afg_enable_rls('"EmployeeAssignment"');
