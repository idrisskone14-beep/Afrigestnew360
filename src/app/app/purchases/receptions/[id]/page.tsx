import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckCircle2, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { confirmReceiptAction, deleteReceiptAction } from "@/modules/purchasing/actions";
import { getReceipt } from "@/modules/purchasing/procurement";
import { DocHeader } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Réception" };

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.receipt.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const r = await getReceipt(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const wh = r.warehouseId && ctx.hasModule("inventory") ? await ctx.db.warehouse.findFirst({ where: { id: r.warehouseId }, select: { name: true } }) : null;
  const canAct = ctx.can("purchases.receipt.create") && r.status === "DRAFT";
  const stock = ctx.hasModule("inventory");

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Réceptions", href: "/app/purchases/receptions" }, { label: r.number }]}
        title={`Réception ${r.number}`}
        badges={<Status value={r.status} />}
        subtitle={<>De <Link href={`/app/purchases/fournisseurs/${r.supplierId}`} className="text-foreground hover:text-brand">{r.supplier.name}</Link> · commande <Link href={`/app/purchases/commandes/${r.order.id}`} className="text-brand hover:underline">{r.order.number}</Link> · {fmtDate(r.receiptDate)}{wh ? ` · ${wh.name}` : ""}</>}
      />
      {canAct && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <ActionButton action={confirmReceiptAction} input={{ id: r.id }} variant="default" label="Confirmer la réception" icon={<CheckCircle2 className="size-4" />} success="Réception confirmée" confirm={{ title: "Confirmer la réception ?", description: stock ? "Les quantités sont mises à jour sur la commande et entrées en stock, valorisées au coût de la commande." : "Les quantités sont mises à jour sur la commande.", confirmLabel: "Confirmer" }} />
            <ActionButton action={deleteReceiptAction} input={{ id: r.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/purchases/receptions" success="Brouillon supprimé" confirm={{ title: "Supprimer ce bon ?" }} />
          </CardContent>
        </Card>
      )}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Désignation</TableHead><TableHead className="text-right">Qté reçue</TableHead><TableHead className="text-right">Coût unitaire</TableHead></TableRow></TableHeader>
          <TableBody>
            {r.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="max-w-xs whitespace-normal text-sm">{l.description}</TableCell>
                <TableCell className="text-right text-sm tabular">{num(l.quantity)} {l.unit}</TableCell>
                <TableCell className="text-right text-sm tabular">{formatMoney(num(l.unitCost), ctx.company.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {r.notes && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Notes</p>{r.notes}</CardContent></Card>}
    </div>
  );
}
