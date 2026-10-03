-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SiteBudgetCategory" AS ENUM ('MATERIALS', 'LABOUR', 'EQUIPMENT', 'SUBCONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "SubcontractStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SiteStockType" AS ENUM ('ISSUE', 'RETURN');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'VAN', 'TRUCK', 'TRAILER', 'MOTORCYCLE', 'MACHINE', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'IN_MAINTENANCE', 'OUT_OF_SERVICE', 'SOLD');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'PETROL', 'ELECTRIC', 'HYBRID', 'GAS', 'NONE');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LEFT');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'REPAIR', 'TIRES', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('PLANNED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComplianceKind" AS ENUM ('INSURANCE', 'TECHNICAL_INSPECTION', 'REGISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('TO_PAY', 'PAID', 'CONTESTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ConstructionSite" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "customerId" UUID,
    "address" TEXT,
    "city" TEXT,
    "managerId" UUID,
    "status" "SiteStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" DATE,
    "endDate" DATE,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ConstructionSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteBudgetLine" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "category" "SiteBudgetCategory" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "SiteBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMember" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "role" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,

    CONSTRAINT "SiteMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEquipment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "vehicleId" UUID,
    "name" TEXT NOT NULL,
    "dailyRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE,

    CONSTRAINT "SiteEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMaterialPlan" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "plannedQty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "SiteMaterialPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMaterialIssue" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "type" "SiteStockType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "movementId" UUID,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteMaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSubcontract" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "contractAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "SubcontractStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteSubcontract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteReport" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "authorId" UUID NOT NULL,
    "weather" TEXT,
    "workforce" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "incidents" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "name" TEXT,
    "type" "VehicleType" NOT NULL DEFAULT 'TRUCK',
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "vin" TEXT,
    "fuelType" "FuelType" NOT NULL DEFAULT 'DIESEL',
    "odometer" INTEGER NOT NULL DEFAULT 0,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" DATE,
    "acquisitionCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "branchId" UUID,
    "costCenterId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "employeeId" UUID,
    "phone" TEXT,
    "licenseNumber" TEXT,
    "licenseCategory" TEXT,
    "licenseExpiry" DATE,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleAssignment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "startKm" INTEGER,
    "endKm" INTEGER,
    "distanceKm" INTEGER,
    "cargo" TEXT,
    "customerId" UUID,
    "projectId" UUID,
    "revenue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLog" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "date" DATE NOT NULL,
    "liters" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "odometer" INTEGER NOT NULL,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "station" TEXT,
    "expenseId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'PLANNED',
    "date" DATE NOT NULL,
    "odometer" INTEGER,
    "description" TEXT NOT NULL,
    "supplierId" UUID,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "nextDueDate" DATE,
    "nextDueKm" INTEGER,
    "expenseId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCompliance" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "kind" "ComplianceKind" NOT NULL,
    "reference" TEXT,
    "provider" TEXT,
    "startDate" DATE,
    "expiresAt" DATE NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficFine" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "date" DATE NOT NULL,
    "time" TEXT,
    "place" TEXT,
    "offence" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dueDate" DATE,
    "status" "FineStatus" NOT NULL DEFAULT 'TO_PAY',
    "paidAt" DATE,
    "contestReason" TEXT,
    "notes" TEXT,
    "expenseId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficFine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionSite_projectId_key" ON "ConstructionSite"("projectId");

-- CreateIndex
CREATE INDEX "ConstructionSite_companyId_status_idx" ON "ConstructionSite"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionSite_companyId_code_key" ON "ConstructionSite"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SiteBudgetLine_siteId_category_key" ON "SiteBudgetLine"("siteId", "category");

-- CreateIndex
CREATE INDEX "SiteMember_companyId_siteId_idx" ON "SiteMember"("companyId", "siteId");

-- CreateIndex
CREATE INDEX "SiteMember_companyId_employeeId_idx" ON "SiteMember"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "SiteEquipment_companyId_siteId_idx" ON "SiteEquipment"("companyId", "siteId");

-- CreateIndex
CREATE INDEX "SiteEquipment_companyId_vehicleId_idx" ON "SiteEquipment"("companyId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteMaterialPlan_siteId_productId_key" ON "SiteMaterialPlan"("siteId", "productId");

-- CreateIndex
CREATE INDEX "SiteMaterialIssue_companyId_siteId_date_idx" ON "SiteMaterialIssue"("companyId", "siteId", "date");

-- CreateIndex
CREATE INDEX "SiteMaterialIssue_companyId_productId_idx" ON "SiteMaterialIssue"("companyId", "productId");

-- CreateIndex
CREATE INDEX "SiteSubcontract_companyId_siteId_idx" ON "SiteSubcontract"("companyId", "siteId");

-- CreateIndex
CREATE INDEX "SiteReport_companyId_date_idx" ON "SiteReport"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SiteReport_siteId_date_key" ON "SiteReport"("siteId", "date");

-- CreateIndex
CREATE INDEX "Vehicle_companyId_status_idx" ON "Vehicle"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_companyId_plate_key" ON "Vehicle"("companyId", "plate");

-- CreateIndex
CREATE INDEX "Driver_companyId_status_idx" ON "Driver"("companyId", "status");

-- CreateIndex
CREATE INDEX "VehicleAssignment_companyId_vehicleId_startDate_idx" ON "VehicleAssignment"("companyId", "vehicleId", "startDate");

-- CreateIndex
CREATE INDEX "VehicleAssignment_companyId_driverId_idx" ON "VehicleAssignment"("companyId", "driverId");

-- CreateIndex
CREATE INDEX "Trip_companyId_vehicleId_plannedStart_idx" ON "Trip"("companyId", "vehicleId", "plannedStart");

-- CreateIndex
CREATE INDEX "Trip_companyId_driverId_plannedStart_idx" ON "Trip"("companyId", "driverId", "plannedStart");

-- CreateIndex
CREATE INDEX "Trip_companyId_status_idx" ON "Trip"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_companyId_number_key" ON "Trip"("companyId", "number");

-- CreateIndex
CREATE INDEX "FuelLog_companyId_vehicleId_date_idx" ON "FuelLog"("companyId", "vehicleId", "date");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_companyId_vehicleId_date_idx" ON "MaintenanceRecord"("companyId", "vehicleId", "date");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_companyId_status_date_idx" ON "MaintenanceRecord"("companyId", "status", "date");

-- CreateIndex
CREATE INDEX "VehicleCompliance_companyId_vehicleId_kind_expiresAt_idx" ON "VehicleCompliance"("companyId", "vehicleId", "kind", "expiresAt");

-- CreateIndex
CREATE INDEX "VehicleCompliance_companyId_expiresAt_idx" ON "VehicleCompliance"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "TrafficFine_companyId_vehicleId_date_idx" ON "TrafficFine"("companyId", "vehicleId", "date");

-- CreateIndex
CREATE INDEX "TrafficFine_companyId_driverId_date_idx" ON "TrafficFine"("companyId", "driverId", "date");

-- CreateIndex
CREATE INDEX "TrafficFine_companyId_status_dueDate_idx" ON "TrafficFine"("companyId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "TrafficFine_companyId_number_key" ON "TrafficFine"("companyId", "number");

-- AddForeignKey
ALTER TABLE "ConstructionSite" ADD CONSTRAINT "ConstructionSite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBudgetLine" ADD CONSTRAINT "SiteBudgetLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteBudgetLine" ADD CONSTRAINT "SiteBudgetLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConstructionSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMember" ADD CONSTRAINT "SiteMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMember" ADD CONSTRAINT "SiteMember_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConstructionSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEquipment" ADD CONSTRAINT "SiteEquipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEquipment" ADD CONSTRAINT "SiteEquipment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConstructionSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMaterialPlan" ADD CONSTRAINT "SiteMaterialPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMaterialPlan" ADD CONSTRAINT "SiteMaterialPlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConstructionSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMaterialIssue" ADD CONSTRAINT "SiteMaterialIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMaterialIssue" ADD CONSTRAINT "SiteMaterialIssue_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConstructionSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSubcontract" ADD CONSTRAINT "SiteSubcontract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSubcontract" ADD CONSTRAINT "SiteSubcontract_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConstructionSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ConstructionSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCompliance" ADD CONSTRAINT "VehicleCompliance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCompliance" ADD CONSTRAINT "VehicleCompliance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficFine" ADD CONSTRAINT "TrafficFine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficFine" ADD CONSTRAINT "TrafficFine_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficFine" ADD CONSTRAINT "TrafficFine_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Intégrité des données
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_odometer_check" CHECK ("odometer" >= 0 AND "acquisitionCost" >= 0 AND ("year" IS NULL OR "year" BETWEEN 1950 AND 2100));
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_km_check" CHECK ("revenue" >= 0 AND ("startKm" IS NULL OR "startKm" >= 0) AND ("endKm" IS NULL OR "startKm" IS NULL OR "endKm" >= "startKm") AND ("plannedEnd" IS NULL OR "plannedEnd" >= "plannedStart"));
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_amounts_check" CHECK ("liters" > 0 AND "amount" >= 0 AND "unitPrice" >= 0 AND "odometer" >= 0);
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_cost_check" CHECK ("cost" >= 0 AND ("odometer" IS NULL OR "odometer" >= 0) AND ("nextDueKm" IS NULL OR "nextDueKm" >= 0));
ALTER TABLE "VehicleCompliance" ADD CONSTRAINT "VehicleCompliance_dates_check" CHECK ("cost" >= 0 AND ("startDate" IS NULL OR "expiresAt" >= "startDate"));
ALTER TABLE "TrafficFine" ADD CONSTRAINT "TrafficFine_amount_check" CHECK ("amount" > 0);
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "ConstructionSite" ADD CONSTRAINT "ConstructionSite_progress_check" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "SiteBudgetLine" ADD CONSTRAINT "SiteBudgetLine_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "SiteEquipment" ADD CONSTRAINT "SiteEquipment_rate_check" CHECK ("dailyRate" >= 0 AND ("endDate" IS NULL OR "endDate" >= "startDate"));
ALTER TABLE "SiteMember" ADD CONSTRAINT "SiteMember_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "SiteMaterialPlan" ADD CONSTRAINT "SiteMaterialPlan_qty_check" CHECK ("plannedQty" > 0);
ALTER TABLE "SiteMaterialIssue" ADD CONSTRAINT "SiteMaterialIssue_qty_check" CHECK ("quantity" > 0 AND "unitCost" >= 0);
ALTER TABLE "SiteSubcontract" ADD CONSTRAINT "SiteSubcontract_amount_check" CHECK ("contractAmount" >= 0);
ALTER TABLE "SiteReport" ADD CONSTRAINT "SiteReport_values_check" CHECK ("progress" BETWEEN 0 AND 100 AND "workforce" >= 0);

-- Isolation multi-tenant (RLS)
SELECT afg_enable_rls('"Vehicle"');
SELECT afg_enable_rls('"Driver"');
SELECT afg_enable_rls('"VehicleAssignment"');
SELECT afg_enable_rls('"Trip"');
SELECT afg_enable_rls('"FuelLog"');
SELECT afg_enable_rls('"MaintenanceRecord"');
SELECT afg_enable_rls('"VehicleCompliance"');
SELECT afg_enable_rls('"TrafficFine"');
SELECT afg_enable_rls('"ConstructionSite"');
SELECT afg_enable_rls('"SiteBudgetLine"');
SELECT afg_enable_rls('"SiteMember"');
SELECT afg_enable_rls('"SiteEquipment"');
SELECT afg_enable_rls('"SiteMaterialPlan"');
SELECT afg_enable_rls('"SiteMaterialIssue"');
SELECT afg_enable_rls('"SiteSubcontract"');
SELECT afg_enable_rls('"SiteReport"');
