-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "expiresAt" DATE;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Document_companyId_expiresAt_idx" ON "Document"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "Notification_emailPending_idx" ON "Notification"("emailPending");
