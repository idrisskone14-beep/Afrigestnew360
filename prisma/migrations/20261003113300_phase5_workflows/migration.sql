-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "currentLabel" TEXT,
ADD COLUMN     "currentRoleId" UUID,
ADD COLUMN     "currentStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ruleId" UUID,
ADD COLUMN     "totalSteps" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "resourceType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "maxAmount" DECIMAL(18,2),
    "departmentId" UUID,
    "requesterRoleId" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRuleStep" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "ApprovalRuleStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "decidedById" UUID NOT NULL,
    "decision" "ApprovalStatus" NOT NULL,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRule_companyId_resourceType_isActive_idx" ON "ApprovalRule"("companyId", "resourceType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRuleStep_ruleId_stepOrder_key" ON "ApprovalRuleStep"("ruleId", "stepOrder");

-- CreateIndex
CREATE INDEX "ApprovalDecision_companyId_requestId_idx" ON "ApprovalDecision"("companyId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_requestId_step_key" ON "ApprovalDecision"("requestId", "step");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ApprovalRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_requesterRoleId_fkey" FOREIGN KEY ("requesterRoleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRuleStep" ADD CONSTRAINT "ApprovalRuleStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRuleStep" ADD CONSTRAINT "ApprovalRuleStep_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ApprovalRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRuleStep" ADD CONSTRAINT "ApprovalRuleStep_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Intégrité des chaînes de validation
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_amounts_check" CHECK ("minAmount" >= 0 AND ("maxAmount" IS NULL OR "maxAmount" > "minAmount"));
ALTER TABLE "ApprovalRuleStep" ADD CONSTRAINT "ApprovalRuleStep_order_check" CHECK ("stepOrder" >= 1);
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_steps_check" CHECK ("totalSteps" >= 1 AND "currentStep" >= 1 AND "currentStep" <= "totalSteps");

-- Isolation multi-tenant (RLS)
SELECT afg_enable_rls('"ApprovalRule"');
SELECT afg_enable_rls('"ApprovalRuleStep"');
SELECT afg_enable_rls('"ApprovalDecision"');
