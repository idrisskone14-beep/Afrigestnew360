import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckCircle2, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { deleteCreditNoteAction, issueCreditNoteAction } from "@/modules/sales/actions";
import { getCreditNote } from "@/modules/sales/invoices";
import { DocHeader, LinesView, PdfLinks, TotalsView } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Avoir" };

export default async function CreditNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("finance.credit_note.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const cn = await getCreditNote(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const canUpdate = ctx.can("finance.credit_note.update");
  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Avoirs", href: "/app/sales/avoirs" }, { label: cn.number ?? "Brouillon" }]}
        title={cn.number ? `Avoir ${cn.number}` : "Avoir (brouillon)"}
        badges={<Status value={cn.status} />}
        subtitle={<>Sur la facture <Link href={`/app/sales/factures/${cn.invoiceId}`} className="text-brand hover:underline">{cn.invoice.number}</Link> · {cn.invoice.customer.name} · {fmtDate(cn.issueDate)}</>}
        actions={<PdfLinks kind="credit-note" id={cn.id} />}
      />
      {cn.status === "DRAFT" && canUpdate && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <ActionButton action={issueCreditNoteAction} input={{ id: cn.id }} variant="default" label="Émettre l'avoir" icon={<CheckCircle2 className="size-4" />} success="Avoir émis" confirm={{ title: "Émettre l'avoir ?", description: `Le solde de la facture est réduit${cn.restock ? " et les articles sont remis en stock" : ""}. Un numéro définitif est attribué.`, confirmLabel: "Émettre" }} />
            <ActionButton action={deleteCreditNoteAction} input={{ id: cn.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/sales/avoirs" success="Brouillon supprimé" confirm={{ title: "Supprimer ce brouillon d'avoir ?" }} />
          </CardContent>
        </Card>
      )}
      <p className="text-sm text-muted-foreground">Motif : {cn.reason}{cn.restock ? " · retour en stock" : ""}</p>
      <LinesView lines={cn.lines} currency={cn.currency} />
      <TotalsView currency={cn.currency} rows={[{ label: "Total HT", value: num(cn.subtotal) }, { label: "TVA / taxes", value: cn.taxTotal }, { label: "Total avoir", value: cn.total, bold: true }]} />
    </div>
  );
}
