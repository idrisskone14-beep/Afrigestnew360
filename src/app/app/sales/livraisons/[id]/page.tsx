import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PackageCheck, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { confirmDeliveryAction, deleteDeliveryAction } from "@/modules/sales/actions";
import { getDelivery } from "@/modules/sales/orders";
import { DocHeader, PdfLinks } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Bon de livraison" };

export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("sales.delivery.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const dl = await getDelivery(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const canUpdate = ctx.can("sales.delivery.update");
  const warehouse = dl.warehouseId ? await ctx.db.warehouse.findFirst({ where: { id: dl.warehouseId }, select: { name: true } }) : null;

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Livraisons", href: "/app/sales/livraisons" }, { label: dl.number }]}
        title={`Bon de livraison ${dl.number}`}
        badges={<Status value={dl.status} />}
        subtitle={<>Commande <Link href={`/app/sales/commandes/${dl.order.id}`} className="text-brand hover:underline">{dl.order.number}</Link> · {dl.customer.name} · {fmtDate(dl.deliveryDate)}{warehouse ? ` · depuis ${warehouse.name}` : ""}</>}
        actions={<PdfLinks kind="delivery" id={dl.id} />}
      />
      {dl.status === "DRAFT" && canUpdate && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <ActionButton action={confirmDeliveryAction} input={{ id: dl.id }} variant="default" label="Confirmer la livraison" icon={<PackageCheck className="size-4" />} success="Livraison confirmée" confirm={{ title: "Confirmer la livraison ?", description: "Les quantités sont marquées livrées et le stock est décrémenté (si le module Stock est actif). Opération non annulable.", confirmLabel: "Confirmer" }} />
            <ActionButton action={deleteDeliveryAction} input={{ id: dl.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/sales/livraisons" success="Bon supprimé" confirm={{ title: "Supprimer ce bon de livraison ?" }} />
          </CardContent>
        </Card>
      )}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Désignation</TableHead><TableHead className="text-right">Quantité</TableHead></TableRow></TableHeader>
          <TableBody>{dl.lines.map((l) => <TableRow key={l.id}><TableCell className="text-sm">{l.description}</TableCell><TableCell className="text-right text-sm tabular">{num(l.quantity)} {l.unit}</TableCell></TableRow>)}</TableBody>
        </Table>
      </Card>
      {dl.notes && <p className="text-sm text-muted-foreground">Notes : {dl.notes}</p>}
    </div>
  );
}
