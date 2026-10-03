import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Ban, Pencil, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { d, num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { cancelInvoiceAction, deleteInvoiceAction } from "@/modules/sales/actions";
import { customerBalance, getInvoice, invoiceBalance, isOverdue } from "@/modules/sales/invoices";
import { DocHeader, LinesView, PdfLinks, TotalsView } from "@/modules/sales/ui/doc-kit";
import { CreditNoteDialog, IssueInvoiceDialog, PaymentDialog, ReminderDialog } from "@/modules/sales/ui/invoice-dialogs";
import { PaymentRowActions } from "@/modules/sales/ui/payment-row-actions";

export const metadata: Metadata = { title: "Facture" };
const METHOD: Record<string, string> = { CASH: "Espèces", BANK_TRANSFER: "Virement", CHEQUE: "Chèque", MOBILE_MONEY: "Mobile money", CARD: "Carte", OTHER: "Autre" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("finance.invoice.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const i = await getInvoice(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const cur = i.currency;
  const balance = invoiceBalance(i).toNumber();
  const overdue = isOverdue(i);
  const live = i.status === "ISSUED" || i.status === "PARTIALLY_PAID" || i.status === "PAID";
  const open = i.status === "ISSUED" || i.status === "PARTIALLY_PAID";
  const canUpdate = ctx.can("finance.invoice.update");
  const canValidate = ctx.can("finance.payment.validate");
  const accounts = ctx.hasModule("finance") && ctx.can("finance.account.read") ? await ctx.db.financeAccount.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }) : [];

  // lignes créditables = quantité facturée − déjà créditée (avoirs non annulés)
  const credited = await ctx.db.creditNoteLine.findMany({ where: { creditNote: { invoiceId: id, status: { not: "CANCELLED" } } }, select: { invoiceLineId: true, quantity: true } });
  const creditedBy = new Map<string, number>();
  for (const c of credited) if (c.invoiceLineId) creditedBy.set(c.invoiceLineId, (creditedBy.get(c.invoiceLineId) ?? 0) + num(c.quantity));
  const creditable = i.lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit, unitPrice: num(l.unitPrice), creditable: d(l.quantity).minus(creditedBy.get(l.id) ?? 0).toNumber() }));

  // contexte crédit pour l'émission d'un brouillon
  let creditWarning: string | undefined;
  if (i.status === "DRAFT" && i.customer.creditLimit) {
    const bal = await customerBalance(ctx, i.customerId);
    if (bal.outstanding.plus(i.total).gt(i.customer.creditLimit)) creditWarning = `Plafond de crédit (${formatMoney(num(i.customer.creditLimit), cur)}) dépassé avec cette facture : encours actuel ${formatMoney(bal.outstanding.toNumber(), cur)}.`;
  }

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Factures", href: "/app/sales/factures" }, { label: i.number ?? "Brouillon" }]}
        title={i.number ? `Facture ${i.number}` : "Facture (brouillon)"}
        badges={<Status value={overdue ? "OVERDUE" : i.status} />}
        subtitle={<>Pour <Link href={`/app/crm/clients/${i.customerId}`} className="text-foreground hover:text-brand">{i.customer.name}</Link> · émise le {fmtDate(i.issueDate)} · échéance {fmtDate(i.dueDate)}{i.orderId ? <> · <Link href={`/app/sales/commandes/${i.orderId}`} className="text-brand hover:underline">commande</Link></> : null}</>}
        actions={<><PdfLinks kind="invoice" id={i.id} />{canUpdate && i.status === "DRAFT" && <Button variant="outline" asChild><Link href={`/app/sales/factures/${i.id}/modifier`}><Pencil className="size-4" /> Modifier</Link></Button>}</>}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {i.status === "DRAFT" && canUpdate && <IssueInvoiceDialog invoiceId={i.id} total={num(i.total)} currency={cur} canOverride={ctx.can("sales.discount.approve")} creditWarning={creditWarning} />}
          {open && ctx.can("finance.payment.create") && balance > 0 && <PaymentDialog invoiceId={i.id} balance={balance} currency={cur} willValidate={canValidate} accounts={accounts} />}
          {live && ctx.can("finance.credit_note.create") && creditable.some((l) => l.creditable > 0) && <CreditNoteDialog invoiceId={i.id} lines={creditable} />}
          {overdue && canUpdate && <ReminderDialog invoiceId={i.id} hasEmail={Boolean(i.customer.email)} nextLevel={i.reminders.length + 1} />}
          {open && ctx.can("finance.invoice.delete") && i.payments.every((p) => p.status === "CANCELLED") && num(i.creditedAmount) === 0 && <ActionButton action={cancelInvoiceAction} input={{ id: i.id }} variant="outline" label="Annuler la facture" icon={<Ban className="size-4" />} success="Facture annulée" confirm={{ title: "Annuler cette facture ?", description: "Le numéro est conservé (statut « annulée ») et les quantités facturées sont libérées sur la commande.", confirmLabel: "Annuler la facture" }} />}
          {i.status === "DRAFT" && ctx.can("finance.invoice.delete") && <ActionButton action={deleteInvoiceAction} input={{ id: i.id }} variant="destructive" label="Supprimer le brouillon" icon={<Trash2 className="size-4" />} redirectTo="/app/sales/factures" success="Brouillon supprimé" confirm={{ title: "Supprimer ce brouillon ?" }} />}
          {i.status === "CANCELLED" && <p className="text-sm text-muted-foreground">Facture annulée le {fmtDate(i.cancelledAt)}.</p>}
        </CardContent>
      </Card>

      <LinesView lines={i.lines} currency={cur} />
      <TotalsView currency={cur} rows={[
        { label: "Total HT", value: num(i.subtotal) },
        ...(num(i.discountTotal) ? [{ label: "Remises", value: -num(i.discountTotal) }] : []),
        { label: "TVA / taxes", value: i.taxTotal },
        { label: "Total TTC", value: i.total, bold: !live },
        ...(num(i.creditedAmount) ? [{ label: "Avoirs émis", value: -num(i.creditedAmount) }] : []),
        ...(num(i.amountPaid) ? [{ label: "Déjà réglé", value: -num(i.amountPaid), tone: "success" as const }] : []),
        ...(live ? [{ label: balance < 0 ? "Trop-perçu" : "Reste à payer", value: Math.abs(balance), bold: true, tone: overdue ? ("danger" as const) : undefined }] : []),
      ]} />

      {i.installments.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Échéancier</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {i.installments.map((x) => {
              const paid = num(x.paidAmount) >= num(x.amount);
              return <div key={x.id} className="flex items-center gap-3 px-6 py-3 text-sm"><span className="flex-1">Échéance {x.position + 1} · {fmtDate(x.dueDate)}</span><span className="tabular">{formatMoney(num(x.amount), cur)}</span><Status value={paid ? "PAID" : num(x.paidAmount) > 0 ? "PARTIALLY_PAID" : x.dueDate < new Date() ? "OVERDUE" : "ISSUED"} /></div>;
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Paiements</CardTitle></CardHeader>
          <CardContent className="p-0">
            {i.payments.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun paiement enregistré.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Reçu</TableHead><TableHead>Date</TableHead><TableHead className="hidden sm:table-cell">Mode</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead><TableHead className="w-10"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
                <TableBody>
                  {i.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm font-medium">{p.number}<span className="block text-xs font-normal text-muted-foreground">{p.reference ?? ""}</span></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(p.date)}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{METHOD[p.method]}</TableCell>
                      <TableCell className="text-right text-sm tabular">{formatMoney(num(p.amount), cur)}</TableCell>
                      <TableCell><Status value={p.status === "VALIDATED" ? "PAID" : p.status === "CANCELLED" ? "CANCELLED" : "PENDING_APPROVAL"} /></TableCell>
                      <TableCell><PaymentRowActions id={p.id} status={p.status} canValidate={canValidate} canCancel={ctx.can("finance.payment.create") && (p.status === "PENDING" || canValidate)} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {i.creditNotes.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Avoirs</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
              {i.creditNotes.map((c) => <Link key={c.id} href={`/app/sales/avoirs/${c.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{c.number ?? "Brouillon"}</span><span className="tabular text-sm">{formatMoney(num(c.total), cur)}</span><Status value={c.status} /></Link>)}
            </CardContent>
          </Card>
        )}
        {i.reminders.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Relances</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
              {i.reminders.map((r) => <div key={r.id} className="px-6 py-3 text-sm"><p className="font-medium">Relance n°{r.level} · {r.channel === "EMAIL" ? "e-mail" : r.channel === "PHONE" ? "appel" : "autre"}</p><p className="text-xs text-muted-foreground">{fmtDate(r.sentAt)}{r.note ? ` · ${r.note}` : ""}</p></div>)}
            </CardContent>
          </Card>
        )}
      </div>
      {(i.notes || i.terms) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {i.notes && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Notes</p>{i.notes}</CardContent></Card>}
          {i.terms && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Conditions</p>{i.terms}</CardContent></Card>}
        </div>
      )}
      <EntityDocuments ctx={ctx} type="invoice" id={id} />
    </div>
  );
}
