import type { Metadata } from "next";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { listWarehouses } from "@/modules/inventory/service";
import { CountSheet } from "@/modules/inventory/ui/count-sheet";

export const metadata: Metadata = { title: "Inventaire" };

export default async function CountPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("inventory.count.manage");
  const sp = await searchParams;
  const warehouses = await listWarehouses(ctx);
  const warehouse = warehouses.find((w) => w.id === param(sp, "entrepot")) ?? warehouses[0];
  const levels = warehouse
    ? await ctx.db.stockLevel.findMany({ where: { warehouseId: warehouse.id, product: { deletedAt: null, trackStock: true } }, include: { product: { select: { id: true, name: true, sku: true, unit: true } } }, orderBy: { product: { name: "asc" } }, take: 500 })
    : [];
  // produits suivis sans niveau dans cet entrepôt : comptables à 0
  const tracked = warehouse ? await ctx.db.product.findMany({ where: { deletedAt: null, trackStock: true, isActive: true }, select: { id: true, name: true, sku: true, unit: true }, orderBy: { name: "asc" }, take: 500 }) : [];
  const theoretical = new Map(levels.map((l) => [l.productId, num(l.quantity)]));
  const rows = tracked.map((p) => ({ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, theoretical: theoretical.get(p.id) ?? 0 }));

  return <CountSheet warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} warehouseId={warehouse?.id ?? null} rows={rows} />;
}
