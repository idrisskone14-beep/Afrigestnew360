-- Fiche salarié : état civil (nationalité, lieu de naissance, situation matrimoniale), enfants et numéro CNPS.
-- Migration additive : colonnes facultatives ou à 0 par défaut, rien n'est modifié dans l'existant.

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "birthPlace" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "maritalStatus" "MaritalStatus",
ADD COLUMN     "childrenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "insuredChildren" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cnpsNumber" TEXT;
