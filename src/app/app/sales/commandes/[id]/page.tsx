import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Ban, CheckCircle2, FileText, Pencil, Trash2 } from "lucide-react";
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
import { cancelOrderAction, confirmOrderAction, deleteOrderAction, invoiceFromOrderAction } from "@/modules/sales/actions";
import { getOrder } from "@/modules/sales/orders";
import { depositsOf } from "@/modules/sales/deposits";
import { DepositDialog } from "@/modules/sales/ui/deposit-dialog";
import { DepositsCard } from "@/modules/sales/ui/deposits-card";
import { DocHeader, PdfLinks } from "@/modules/sales/ui/doc-kit";
import { DocumentPreview } from "@/modules/sales/ui/document-preview";
import { orderPreview } from "@/modules/sales/ui/sales-editor-data";
import { CreateDeliveryDialog } from "@/modules/sales/ui/delivery-dialog";

export const metadata: Metadata = { title: "Commande" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("sales.order.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const o = await getOrder(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const canUpdate = ctx.can("sales.order.update");
  const [warehouses, draftLines] = await Promise.all([
    ctx.hasModule("inventory") ? ctx.db.warehouse.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ctx.db.deliveryLine.findMany({ where: { delivery: { orderId: id, status: "DRAFT" } }, select: { orderLineId: true, quantity: true } }),
  ]);
  const inDraft = new Map<string, number>();
  for (const x of draftLines) inDraft.set(x.orderLineId, (inDraft.get(x.orderLineId) ?? 0) + num(x.quantity));
  const deliverable = o.lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit, remaining: d(l.quantity).minus(l.deliveredQty).minus(inDraft.get(l.id) ?? 0).toNumber() })).filter((l) => l.remaining > 0);
  const live = o.status === "CONFIRMED" || o.status === "PARTIALLY_DELIVERED";
  const anyDelivered = o.lines.some((l) => num(l.deliveredQty) > 0);
  const deposits = await depositsOf(ctx, { orderId: o.id, quoteId: o.quoteId });
  const invoiceable = (o.status !== "DRAFT" && o.status !== "CANCELLED") && o.lines.some((l) => d(l.quantity).gt(l.invoicedQty));

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Commandes", href: "/app/sales/commandes" }, { label: o.number }]}
        title={`Commande ${o.number}`}
        badges={<Status value={o.status} />}
        subtitle={<>Pour <Link href={`/app/crm/clients/${o.customerId}`} className="text-foreground hover:text-brand">{o.customer.name}</Link> · {fmtDate(o.orderDate)}{o.quoteId ? <> · issue du <Link className="text-brand hover:underline" href={`/app/sales/devis/${o.quoteId}`}>devis</Link></> : null}</>}
        actions={<><PdfLinks kind="order" id={o.id} />{canUpdate && o.status === "DRAFT" && <Button variant="outline" asChild><Link href={`/app/sales/commandes/${o.id}/modifier`}><Pencil className="size-4" /> Modifier</Link></Button>}</>}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {canUpdate && o.status === "DRAFT" && <ActionButton action={confirmOrderAction} input={{ id: o.id }} variant="default" label="Confirmer la commande" icon={<CheckCircle2 className="size-4" />} success="Commande confirmée" confirm={{ title: "Confirmer la commande ?", description: "Le stock disponible est réservé pour cette commande (si le module Stock est actif).", confirmLabel: "Confirmer" }} />}
          {live && ctx.can("sales.delivery.create") && deliverable.length > 0 && <CreateDeliveryDialog orderId={o.id} lines={deliverable} warehouses={warehouses} defaultWarehouseId={o.warehouseId} />}
          {o.status !== "DRAFT" && o.status !== "CANCELLED" && ctx.can("finance.invoice.create") && <DepositDialog source="order" id={o.id} total={num(o.total)} currency={o.currency} />}
          {invoiceable && ctx.can("finance.invoice.create") && (
            <>
              <ActionButton action={invoiceFromOrderAction} input={{ id: o.id, onlyDelivered: false }} label="Facturer la commande" icon={<FileText className="size-4" />} success="Facture brouillon créée" redirectToNew="/app/sales/factures" />
              {anyDelivered && <ActionButton action={invoiceFromOrderAction} input={{ id: o.id, onlyDelivered: true }} label="Facturer le livré" icon={<FileText className="size-4" />} success="Facture brouillon créée" redirectToNew="/app/sales/factures" />}
            </>
          )}
          {canUpdate && o.status !== "CANCELLED" && !anyDelivered && <ActionButton action={cancelOrderAction} input={{ id: o.id }} variant="outline" label="Annuler" icon={<Ban className="size-4" />} success="Commande annulée" confirm={{ title: "Annuler la commande ?", description: "Le stock réservé est libéré.", confirmLabel: "Annuler la commande" }} />}
          {o.status === "DRAFT" && ctx.can("sales.order.delete") && <ActionButton action={deleteOrderAction} input={{ id: o.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/sales/commandes" success="Commande supprimée" confirm={{ title: "Supprimer cette commande ?" }} />}
        </CardContent>
      </Card>

      <section aria-label="Document" className="rounded-xl bg-muted/70 p-3 sm:p-6">
        <DocumentPreview data={await orderPreview(ctx, o)} />
      </section>

      <DepositsCard rows={deposits} currency={o.currency} />

      {o.status !== "DRAFT" && (
        <Card className="overflow-hidden">
          <CardHeader><CardTitle className="text-base">Avancement par ligne</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Désignation</TableHead><TableHead className="text-right">Commandé</TableHead><TableHead className="text-right">Livré</TableHead><TableHead className="text-right">Facturé</TableHead></TableRow></TableHeader>
              <TableBody>
                {o.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-xs whitespace-normal text-sm">{l.description}</TableCell>
                    <TableCell className="text-right text-sm tabular">{num(l.quantity)} {l.unit}</TableCell>
                    <TableCell className="text-right text-sm tabular">{num(l.deliveredQty)}</TableCell>
                    <TableCell className="text-right text-sm tabular">{num(l.invoicedQty)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Livraisons</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {o.deliveries.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune livraison.</p>}
            {o.deliveries.map((dl) => (
              <Link key={dl.id} href={`/app/sales/livraisons/${dl.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{dl.number}</span><span className="text-xs text-muted-foreground">{fmtDate(dl.deliveryDate)}</span><Status value={dl.status} /></Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Factures</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {o.invoices.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune facture.</p>}
            {o.invoices.map((i) => (
              <Link key={i.id} href={`/app/sales/factures/${i.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{i.number ?? "Brouillon"}</span><span className="tabular text-xs text-muted-foreground">{formatMoney(num(i.total), o.currency)}</span><Status value={i.status} /></Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
