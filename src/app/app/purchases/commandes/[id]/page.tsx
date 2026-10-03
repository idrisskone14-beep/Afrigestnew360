import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Ban, FileText, Pencil, Send, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canDecide } from "@/core/approvals";
import { AppError } from "@/core/errors";
import { d, num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { billFromOrderAction, cancelOrderAction, deleteOrderAction, submitOrderAction } from "@/modules/purchasing/actions";
import { getOrder } from "@/modules/purchasing/procurement";
import { CreateReceiptDialog, DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";
import { DocHeader, LinesView, PdfLinks, TotalsView } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Commande fournisseur" };

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.order.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const o = await getOrder(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const canUpdate = ctx.can("purchases.order.update");
  const [warehouses, draftLines, pending] = await Promise.all([
    ctx.hasModule("inventory") ? ctx.db.warehouse.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ctx.db.goodsReceiptLine.findMany({ where: { receipt: { orderId: id, status: "DRAFT" } }, select: { orderLineId: true, quantity: true } }),
    o.status === "PENDING_APPROVAL" ? ctx.db.approvalRequest.findFirst({ where: { resourceType: "purchase_order", resourceId: id, status: "PENDING" } }) : Promise.resolve(null),
  ]);
  const inDraft = new Map<string, number>();
  for (const x of draftLines) inDraft.set(x.orderLineId, (inDraft.get(x.orderLineId) ?? 0) + num(x.quantity));
  const receivable = o.lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit, remaining: d(l.quantity).minus(l.receivedQty).minus(inDraft.get(l.id) ?? 0).toNumber() })).filter((l) => l.remaining > 0);
  const live = o.status === "APPROVED" || o.status === "PARTIALLY_RECEIVED";
  const anyReceived = o.lines.some((l) => num(l.receivedQty) > 0);
  const billable = ["PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status) && o.lines.some((l) => d(l.receivedQty).gt(l.billedQty));
  const requestedByMe = pending?.requestedById === ctx.user.id;

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Commandes fournisseur", href: "/app/purchases/commandes" }, { label: o.number }]}
        title={`Commande ${o.number}`}
        badges={<Status value={o.status} />}
        subtitle={<>Chez <Link href={`/app/purchases/fournisseurs/${o.supplierId}`} className="text-foreground hover:text-brand">{o.supplier.name}</Link> · {fmtDate(o.orderDate)}{o.expectedDate ? ` · attendue le ${fmtDate(o.expectedDate)}` : ""}{o.requestId ? <> · issue d'une <Link className="text-brand hover:underline" href={`/app/purchases/demandes/${o.requestId}`}>demande d'achat</Link></> : null}</>}
        actions={<><PdfLinks kind="purchase-order" id={o.id} />{canUpdate && o.status === "DRAFT" && <Button variant="outline" asChild><Link href={`/app/purchases/commandes/${o.id}/modifier`}><Pencil className="size-4" /> Modifier</Link></Button>}</>}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {canUpdate && o.status === "DRAFT" && <ActionButton action={submitOrderAction} input={{ id: o.id }} variant="default" label="Valider la commande" icon={<Send className="size-4" />} success="Commande traitée" confirm={{ title: "Valider la commande ?", description: "Au-delà du seuil défini par l'entreprise, elle est envoyée à un approbateur avant de pouvoir être réceptionnée.", confirmLabel: "Valider" }} />}
          {pending && !requestedByMe && canDecide(ctx, "purchase_order") && <DecisionButtons id={pending.id} title={`Commande ${o.number}`} />}
          {pending && requestedByMe && <p className="text-sm text-muted-foreground">En attente de validation par un approbateur.</p>}
          {live && ctx.can("purchases.receipt.create") && receivable.length > 0 && <CreateReceiptDialog orderId={o.id} lines={receivable} warehouses={warehouses} defaultWarehouseId={o.warehouseId} />}
          {billable && ctx.can("purchases.bill.create") && (
            <>
              <ActionButton action={billFromOrderAction} input={{ id: o.id, onlyReceived: true }} label="Facturer le reçu" icon={<FileText className="size-4" />} success="Facture fournisseur brouillon créée" redirectToNew="/app/purchases/factures" />
            </>
          )}
          {canUpdate && o.status !== "CANCELLED" && !anyReceived && o.bills.every((b) => b.status === "CANCELLED") && <ActionButton action={cancelOrderAction} input={{ id: o.id }} variant="outline" label="Annuler" icon={<Ban className="size-4" />} success="Commande annulée" confirm={{ title: "Annuler la commande ?", confirmLabel: "Annuler la commande" }} />}
          {o.status === "DRAFT" && ctx.can("purchases.order.delete") && <ActionButton action={deleteOrderAction} input={{ id: o.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/purchases/commandes" success="Commande supprimée" confirm={{ title: "Supprimer cette commande ?" }} />}
        </CardContent>
      </Card>

      <LinesView lines={o.lines.map((l) => ({ ...l, deliveredQty: l.receivedQty, invoicedQty: l.billedQty }))} currency={o.currency} showProgress progressLabels={["Reçu", "Facturé"]} />
      <TotalsView currency={o.currency} rows={[{ label: "Total HT", value: num(o.subtotal) }, ...(num(o.discountTotal) ? [{ label: "Remises", value: -num(o.discountTotal) }] : []), { label: "TVA / taxes", value: o.taxTotal }, { label: "Total TTC", value: o.total, bold: true }]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Réceptions</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {o.receipts.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune réception.</p>}
            {o.receipts.map((r) => (
              <Link key={r.id} href={`/app/purchases/receptions/${r.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{r.number}</span><span className="text-xs text-muted-foreground">{fmtDate(r.receiptDate)}</span><Status value={r.status} /></Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Factures fournisseur</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {o.bills.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune facture.</p>}
            {o.bills.map((b) => (
              <Link key={b.id} href={`/app/purchases/factures/${b.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{b.number ?? "Brouillon"}{b.supplierRef ? <span className="ml-2 text-xs font-normal text-muted-foreground">{b.supplierRef}</span> : null}</span><span className="tabular text-xs text-muted-foreground">{formatMoney(num(b.total), o.currency)}</span><Status value={b.status} /></Link>
            ))}
          </CardContent>
        </Card>
      </div>
      {o.notes && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Notes</p>{o.notes}</CardContent></Card>}
      <EntityDocuments ctx={ctx} type="purchase_order" id={id} />
    </div>
  );
}
