import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowRight, Check, Pencil, Send, Trash2, X } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { convertQuoteToInvoiceAction, convertQuoteToOrderAction, deleteQuoteAction, setQuoteStatusAction } from "@/modules/sales/actions";
import { effectiveQuoteStatus, getQuote } from "@/modules/sales/quotes";
import { DocHeader, LinesView, PdfLinks, TotalsView } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Devis" };

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("sales.quote.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const q = await getQuote(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const status = effectiveQuoteStatus(q);
  const canUpdate = ctx.can("sales.quote.update");
  const editable = canUpdate && (q.status === "DRAFT" || q.status === "SENT");
  const convertible = q.status !== "CONVERTED" && q.status !== "REJECTED" && status !== "EXPIRED";
  const label = q.kind === "PROFORMA" ? "Proforma" : "Devis";

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Devis", href: "/app/sales/devis" }, { label: q.number }]}
        title={`${label} ${q.number}`}
        badges={<Status value={status} />}
        subtitle={<>Pour <Link href={`/app/crm/clients/${q.customerId}`} className="text-foreground hover:text-brand">{q.customer.name}</Link> · émis le {fmtDate(q.issueDate)} · valable jusqu'au {fmtDate(q.validUntil)}</>}
        actions={
          <>
            <PdfLinks kind="quote" id={q.id} />
            {editable && <Button variant="outline" asChild><Link href={`/app/sales/devis/${q.id}/modifier`}><Pencil className="size-4" /> Modifier</Link></Button>}
          </>
        }
      />

      {canUpdate && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            {q.status === "DRAFT" && <ActionButton action={setQuoteStatusAction} input={{ id: q.id, status: "SENT" as const }} label="Marquer comme envoyé" icon={<Send className="size-4" />} success="Devis marqué comme envoyé" />}
            {(q.status === "DRAFT" || q.status === "SENT") && status !== "EXPIRED" && <ActionButton action={setQuoteStatusAction} input={{ id: q.id, status: "ACCEPTED" as const }} label="Accepté par le client" icon={<Check className="size-4" />} success="Devis accepté" />}
            {(q.status === "DRAFT" || q.status === "SENT" || q.status === "ACCEPTED") && <ActionButton action={setQuoteStatusAction} input={{ id: q.id, status: "REJECTED" as const }} label="Refusé" icon={<X className="size-4" />} confirm={{ title: "Marquer comme refusé ?", description: "Le devis ne pourra plus être converti." }} />}
            {convertible && q.kind === "QUOTE" && ctx.can("sales.order.create") && <ActionButton action={convertQuoteToOrderAction} input={{ id: q.id }} variant="default" label="Convertir en commande" icon={<ArrowRight className="size-4" />} success="Commande créée" redirectToNew="/app/sales/commandes" confirm={{ title: "Convertir en commande ?", description: "Les lignes sont copiées sans ressaisie et le stock est réservé (si le module Stock est actif). Le devis passe à « Converti ».", confirmLabel: "Convertir" }} />}
            {convertible && ctx.can("finance.invoice.create") && <ActionButton action={convertQuoteToInvoiceAction} input={{ id: q.id }} label="Convertir en facture" icon={<ArrowRight className="size-4" />} success="Facture brouillon créée" redirectToNew="/app/sales/factures" confirm={{ title: "Convertir en facture ?", description: "Une facture brouillon est créée avec les mêmes lignes ; vous pourrez la relire avant de l'émettre.", confirmLabel: "Convertir" }} />}
            {q.status === "DRAFT" && ctx.can("sales.quote.delete") && <ActionButton action={deleteQuoteAction} input={{ id: q.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/sales/devis" success="Devis supprimé" confirm={{ title: "Supprimer ce devis ?", description: "Cette action est définitive." }} />}
          </CardContent>
        </Card>
      )}
      {q.convertedOrderId && <p className="text-sm text-muted-foreground">Converti en <Link className="text-brand hover:underline" href={`/app/sales/commandes/${q.convertedOrderId}`}>commande</Link>.</p>}
      {q.convertedInvoiceId && <p className="text-sm text-muted-foreground">Converti en <Link className="text-brand hover:underline" href={`/app/sales/factures/${q.convertedInvoiceId}`}>facture</Link>.</p>}

      <LinesView lines={q.lines} currency={q.currency} />
      <TotalsView currency={q.currency} rows={[
        { label: "Total HT", value: num(q.subtotal) },
        ...(num(q.discountTotal) ? [{ label: "Remises", value: -num(q.discountTotal) }] : []),
        { label: "TVA / taxes", value: q.taxTotal },
        { label: "Total TTC", value: q.total, bold: true },
      ]} />
      {(q.notes || q.terms) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {q.notes && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Notes</p>{q.notes}</CardContent></Card>}
          {q.terms && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Conditions</p>{q.terms}</CardContent></Card>}
        </div>
      )}
    </div>
  );
}
