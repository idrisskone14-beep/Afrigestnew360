-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'PENDING';

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);
