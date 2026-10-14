-- CreateEnum
CREATE TYPE "LeaveAccrual" AS ENUM ('UPFRONT', 'MONTHLY');

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "accrual" "LeaveAccrual" NOT NULL DEFAULT 'UPFRONT',
ADD COLUMN     "carryOverExpiryMonth" INTEGER,
ADD COLUMN     "carryOverMax" DECIMAL(5,1) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSettings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HrSettings_companyId_key" ON "HrSettings"("companyId");

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSettings" ADD CONSTRAINT "HrSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation par entreprise (RLS)
SELECT afg_enable_rls('"Holiday"');
SELECT afg_enable_rls('"HrSettings"');
