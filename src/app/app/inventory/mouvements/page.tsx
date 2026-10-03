import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { listMovements, listWarehouses } from "@/modules/inventory/service";
import { MovementDialog } from "@/modules/inventory/ui/movement-dialog";

export const metadata: Metadata = { title: "Mouvements de stock" };

const TYPES = ["IN", "OUT", "TRANSFER", "ADJUSTMENT", "RETURN"] as const;
const LABEL: Record<string, string> = { IN: "Entrée", OUT: "Sortie", TRANSFER: "Transfert", ADJUSTMENT: "Ajustement", RETURN: "Retour" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("inventory.movement.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const type = enumParam(sp, "type", TYPES);
  const warehouses = await listWarehouses(ctx);
  const warehouseId = warehouses.find((w) => w.id === param(sp, "entrepot"))?.id;
  const { rows, total } = await listMovements(ctx, { type, warehouseId, skip: lp.skip, take: lp.take });
  const canCreate = ctx.can("inventory.movement.create");
  const products = canCreate ? await ctx.db.product.findMany({ where: { deletedAt: null, isActive: true, trackStock: true }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" }, take: 500 }) : [];

  return (
    <>
      <ListToolbar
        placeholder="Mouvements"
        filters={[
          { name: "type", label: "Type", options: TYPES.map((t) => ({ value: t, label: LABEL[t]! })) },
          { name: "entrepot", label: "Entrepôt", options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
        ]}
      >
        {canCreate && <MovementDialog products={products} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} canAdjust={ctx.can("inventory.stock.adjust")} />}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<ArrowLeftRight className="size-8" />} title="Aucun mouvement" description="Entrées, sorties, transferts et ajustements apparaissent ici, avec leur auteur et leur motif." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Produit</TableHead><TableHead className="hidden sm:table-cell">Type</TableHead><TableHead className="hidden md:table-cell">Entrepôt</TableHead><TableHead className="text-right">Quantité</TableHead><TableHead className="hidden lg:table-cell">Motif / référence</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm text-muted-foreground">{fmtDateTime(m.date)}</TableCell>
                  <TableCell><span className="block truncate text-sm font-medium">{m.product.name}</span><span className="block text-xs text-muted-foreground">{m.product.sku}</span></TableCell>
                  <TableCell className="hidden sm:table-cell"><StatusBadge tone={m.type === "OUT" ? "danger" : m.type === "IN" || m.type === "RETURN" ? "success" : "info"}>{LABEL[m.type]}</StatusBadge></TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{m.warehouse.name}</TableCell>
                  <TableCell className={`text-right text-sm font-medium tabular ${num(m.quantity) < 0 ? "text-destructive" : "text-success"}`}>{num(m.quantity) > 0 ? "+" : ""}{num(m.quantity)} {m.product.unit}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{[m.reason, m.reference].filter(Boolean).join(" · ") || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/inventory/mouvements" searchParams={sp} />
    </>
  );
}
