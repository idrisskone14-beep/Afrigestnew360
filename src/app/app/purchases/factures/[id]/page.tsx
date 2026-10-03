import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Ban, CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { cancelBillAction, cancelSupplierPaymentAction, deleteBillAction, postBillAction } from "@/modules/purchasing/actions";
import { billBalance, getBill, isBillOverdue } from "@/modules/purchasing/bills";
import { SupplierPaymentDialog } from "@/modules/purchasing/ui/purchase-dialogs";
import { DocHeader, LinesView, TotalsView } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Facture fournisseur" };
const METHOD: Record<string, string> = { CASH: "Espèces", BANK_TRANSFER: "Virement", CHEQUE: "Chèque", MOBILE_MONEY: "Mobile money", CARD: "Carte", OTHER: "Autre" };

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.bill.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const b = await getBill(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const cur = b.currency;
  const balance = billBalance(b).toNumber();
  const overdue = isBillOverdue(b);
  const live = ["POSTED", "PARTIALLY_PAID", "PAID"].includes(b.status);
  const open = b.status === "POSTED" || b.status === "PARTIALLY_PAID";
  const canApprove = ctx.can("purchases.bill.approve");
  const accounts = ctx.hasModule("finance") && ctx.can("finance.account.read") ? await ctx.db.financeAccount.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }) : [];

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Factures fournisseur", href: "/app/purchases/factures" }, { label: b.number ?? "Brouillon" }]}
        title={b.number ? `Facture ${b.number}` : "Facture fournisseur (brouillon)"}
        badges={<Status value={overdue ? "OVERDUE" : b.status} />}
        subtitle={<>De <Link href={`/app/purchases/fournisseurs/${b.supplierId}`} className="text-foreground hover:text-brand">{b.supplier.name}</Link>{b.supplierRef ? ` · réf. fournisseur ${b.supplierRef}` : ""} · {fmtDate(b.billDate)} · échéance {fmtDate(b.dueDate)}{b.order ? <> · <Link href={`/app/purchases/commandes/${b.order.id}`} className="text-brand hover:underline">{b.order.number}</Link></> : null}</>}
        actions={ctx.can("purchases.bill.update") && b.status === "DRAFT" ? <Button variant="outline" asChild><Link href={`/app/purchases/factures/${b.id}/modifier`}><Pencil className="size-4" /> Modifier</Link></Button> : undefined}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {b.status === "DRAFT" && canApprove && <ActionButton action={postBillAction} input={{ id: b.id }} variant="default" label="Valider la facture" icon={<CheckCircle2 className="size-4" />} success="Facture validée" confirm={{ title: "Valider la facture fournisseur ?", description: "Le numéro interne est attribué, la dette est enregistrée et la facture n'est plus modifiable.", confirmLabel: "Valider" }} />}
          {open && ctx.can("purchases.payment.create") && balance > 0 && <SupplierPaymentDialog billId={b.id} balance={balance} currency={cur} accounts={accounts} />}
          {open && canApprove && b.payments.every((p) => p.status === "CANCELLED") && <ActionButton action={cancelBillAction} input={{ id: b.id }} variant="outline" label="Annuler la facture" icon={<Ban className="size-4" />} success="Facture annulée" confirm={{ title: "Annuler cette facture ?", description: "Le numéro est conservé (statut « annulée ») et les quantités facturées sont libérées sur la commande.", confirmLabel: "Annuler la facture" }} />}
          {b.status === "DRAFT" && ctx.can("purchases.bill.update") && <ActionButton action={deleteBillAction} input={{ id: b.id }} variant="destructive" label="Supprimer le brouillon" icon={<Trash2 className="size-4" />} redirectTo="/app/purchases/factures" success="Brouillon supprimé" confirm={{ title: "Supprimer ce brouillon ?" }} />}
          {b.status === "CANCELLED" && <p className="text-sm text-muted-foreground">Facture annulée.</p>}
        </CardContent>
      </Card>

      <LinesView lines={b.lines} currency={cur} />
      <TotalsView currency={cur} rows={[
        { label: "Total HT", value: num(b.subtotal) },
        ...(num(b.discountTotal) ? [{ label: "Remises", value: -num(b.discountTotal) }] : []),
        { label: "TVA / taxes", value: b.taxTotal },
        { label: "Total TTC", value: b.total, bold: !live },
        ...(num(b.amountPaid) ? [{ label: "Déjà réglé", value: -num(b.amountPaid), tone: "success" as const }] : []),
        ...(live ? [{ label: "Reste à payer", value: balance, bold: true, tone: overdue ? ("danger" as const) : undefined }] : []),
      ]} />

      <Card className="overflow-hidden">
        <CardHeader><CardTitle className="text-base">Paiements</CardTitle></CardHeader>
        <CardContent className="p-0">
          {b.payments.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun paiement enregistré.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Date</TableHead><TableHead className="hidden sm:table-cell">Mode</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead><TableHead className="w-10"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {b.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm font-medium">{p.number}<span className="block text-xs font-normal text-muted-foreground">{p.reference ?? ""}</span></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(p.date)}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{METHOD[p.method]}</TableCell>
                    <TableCell className="text-right text-sm tabular">{formatMoney(num(p.amount), cur)}</TableCell>
                    <TableCell><Status value={p.status === "VALIDATED" ? "PAID" : p.status === "PENDING" ? "PENDING_APPROVAL" : "CANCELLED"} /></TableCell>
                    <TableCell>{(p.status === "VALIDATED" || p.status === "PENDING") && ctx.can("purchases.payment.create") && <ActionButton action={cancelSupplierPaymentAction} input={{ id: p.id }} size="sm" variant="ghost" label="Annuler" success="Paiement annulé" confirm={{ title: "Annuler ce paiement ?", description: "La dette de la facture est rétablie.", confirmLabel: "Annuler le paiement" }} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {b.notes && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Notes</p>{b.notes}</CardContent></Card>}
      <EntityDocuments ctx={ctx} type="supplier_bill" id={id} />
    </div>
  );
}
