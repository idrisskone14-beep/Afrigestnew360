import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/page-header";
import { Camera } from "lucide-react";
import { requirePagePermission } from "@/core/tenant/guards";
import { listCategories } from "@/modules/finance/treasury";
import { CaptureForm } from "./capture-form";

/** Durée maximale d'exécution (secondes) sur Vercel : imports, exports, PDF et envois de fichiers dépassent la durée par défaut. */
export const maxDuration = 60;

export const metadata: Metadata = { title: "Photographier un justificatif" };

/** Saisie rapide d'une dépense depuis le téléphone, avec la photo du justificatif. */
export default async function CapturePage() {
  const ctx = await requirePagePermission("finance.expense.create");
  const categories = (await listCategories(ctx, { kind: "EXPENSE" })).map((c) => ({ id: c.id, name: c.name }));
  const canAttach = ctx.hasModule("documents") && ctx.can("documents.document.create");
  return (
    <div className="mx-auto max-w-lg">
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Photographier un justificatif</h1>
        <p className="text-sm text-muted-foreground">Prenez la photo, indiquez le montant : la dépense est créée avec son justificatif. <Link href="/app/finance/depenses" className="text-brand hover:underline">Toutes les dépenses</Link></p>
      </header>
      {categories.length === 0 ? (
        <EmptyState icon={<Camera className="size-8" />} title="Aucune catégorie de dépense" description="Créez d'abord une catégorie dans Finance › Catégories." />
      ) : (
        <CaptureForm categories={categories} currency={ctx.company.currency} canAttach={canAttach} />
      )}
    </div>
  );
}
