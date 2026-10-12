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
import { DocHeader, PdfLinks } from "@/modules/sales/ui/doc-kit";
import { depositsOf } from "@/modules/sales/deposits";
import { DepositDialog } from "@/modules/sales/ui/deposit-dialog";
import { DepositsCard } from "@/modules/sales/ui/deposits-card";
import { DispatchHistory } from "@/modules/sales/ui/dispatch-history";
import { DocumentPreview } from "@/modules/sales/ui/document-preview";
import { CopyShareLinkButton, SendDocumentDialog } from "@/modules/sales/ui/send-dialog";
import { listDispatches, sendDefaults } from "@/modules/sales/dispatch";
import { quotePreview } from "@/modules/sales/ui/sales-editor-data";

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
  const sendable = ctx.can("sales.quote.send") && (q.status === "DRAFT" || q.status === "SENT" || q.status === "ACCEPTED") && status !== "EXPIRED";
  const [dispatches, defaults, deposits] = await Promise.all([listDispatches(ctx, "quote", id), sendable ? sendDefaults(ctx, "quote", id) : Promise.resolve(null), depositsOf(ctx, { orderId: null, quoteId: id })]);
  const canDeposit = q.kind === "QUOTE" && convertible && ctx.can("finance.invoice.create");

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
            {sendable && defaults && <SendDocumentDialog kind="quote" id={q.id} defaults={defaults} resend={Boolean(q.sentAt)} />}
            {sendable && <CopyShareLinkButton kind="quote" id={q.id} />}
            {q.status === "DRAFT" && <ActionButton action={setQuoteStatusAction} input={{ id: q.id, status: "SENT" as const }} label="Marquer comme envoyé (hors e-mail)" icon={<Send className="size-4" />} success="Devis marqué comme envoyé" />}
            {(q.status === "DRAFT" || q.status === "SENT") && status !== "EXPIRED" && <ActionButton action={setQuoteStatusAction} input={{ id: q.id, status: "ACCEPTED" as const }} label="Accepté par le client" icon={<Check className="size-4" />} success="Devis accepté" />}
            {(q.status === "DRAFT" || q.status === "SENT" || q.status === "ACCEPTED") && <ActionButton action={setQuoteStatusAction} input={{ id: q.id, status: "REJECTED" as const }} label="Refusé" icon={<X className="size-4" />} confirm={{ title: "Marquer comme refusé ?", description: "Le devis ne pourra plus être converti." }} />}
            {canDeposit && <DepositDialog source="quote" id={q.id} total={num(q.total)} currency={q.currency} />}
            {convertible && q.kind === "QUOTE" && ctx.can("sales.order.create") && <ActionButton action={convertQuoteToOrderAction} input={{ id: q.id }} variant="default" label="Convertir en commande" icon={<ArrowRight className="size-4" />} success="Commande créée" redirectToNew="/app/sales/commandes" confirm={{ title: "Convertir en commande ?", description: "Les lignes sont copiées sans ressaisie et le stock est réservé (si le module Stock est actif). Le devis passe à « Converti ».", confirmLabel: "Convertir" }} />}
            {convertible && ctx.can("finance.invoice.create") && <ActionButton action={convertQuoteToInvoiceAction} input={{ id: q.id }} label="Convertir en facture" icon={<ArrowRight className="size-4" />} success="Facture brouillon créée" redirectToNew="/app/sales/factures" confirm={{ title: "Convertir en facture ?", description: "Une facture brouillon est créée avec les mêmes lignes ; vous pourrez la relire avant de l'émettre.", confirmLabel: "Convertir" }} />}
            {q.status === "DRAFT" && ctx.can("sales.quote.delete") && <ActionButton action={deleteQuoteAction} input={{ id: q.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/sales/devis" success="Devis supprimé" confirm={{ title: "Supprimer ce devis ?", description: "Cette action est définitive." }} />}
          </CardContent>
        </Card>
      )}
      {(q.sentAt || q.respondedAt) && (
        <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
          {q.sentAt && <>Envoyé au client le {fmtDate(q.sentAt)}. </>}
          {q.respondedAt && <><strong>{q.status === "REJECTED" ? "Refusé" : "Accepté"} en ligne</strong>{q.respondedByName ? ` par ${q.respondedByName}` : ""} le {fmtDate(q.respondedAt)}.{q.responseNote ? ` « ${q.responseNote} »` : ""}</>}
        </p>
      )}
      {q.convertedOrderId && <p className="text-sm text-muted-foreground">Converti en <Link className="text-brand hover:underline" href={`/app/sales/commandes/${q.convertedOrderId}`}>commande</Link>.</p>}
      {q.convertedInvoiceId && <p className="text-sm text-muted-foreground">Converti en <Link className="text-brand hover:underline" href={`/app/sales/factures/${q.convertedInvoiceId}`}>facture</Link>.</p>}

      <section aria-label="Document" className="rounded-xl bg-muted/70 p-3 sm:p-6">
        <DocumentPreview data={await quotePreview(ctx, q)} />
      </section>
      <DepositsCard rows={deposits} currency={q.currency} />
      <DispatchHistory rows={dispatches} />
    </div>
  );
}
