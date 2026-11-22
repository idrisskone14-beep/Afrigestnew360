-- Intégration du registre FNE aux ventes : provenance des documents repris et lien avec le registre.
-- Migration additive : colonnes facultatives, rien n'est modifié dans l'existant.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "importSource" TEXT;

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "importSource" TEXT;

-- AlterTable
ALTER TABLE "FneRegistryEntry" ADD COLUMN     "invoiceId" UUID,
ADD COLUMN     "creditNoteId" UUID,
ADD COLUMN     "integratedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FneRegistryEntry_invoiceId_idx" ON "FneRegistryEntry"("invoiceId");

-- CreateIndex
CREATE INDEX "FneRegistryEntry_creditNoteId_idx" ON "FneRegistryEntry"("creditNoteId");

-- AddForeignKey
ALTER TABLE "FneRegistryEntry" ADD CONSTRAINT "FneRegistryEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FneRegistryEntry" ADD CONSTRAINT "FneRegistryEntry_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
