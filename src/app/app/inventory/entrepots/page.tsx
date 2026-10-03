import type { Metadata } from "next";
import { requireTenantContext } from "@/core/tenant/guards";
import { listCategories, listWarehouses } from "@/modules/inventory/service";
import { WarehousesPanel } from "@/modules/inventory/ui/warehouses-panel";

export const metadata: Metadata = { title: "Entrepôts & catégories" };

export default async function WarehousesPage() {
  const ctx = await requireTenantContext();
  ctx.assertCan("inventory.product.read");
  const [warehouses, categories, company] = await Promise.all([
    listWarehouses(ctx),
    listCategories(ctx),
    ctx.db.company.findFirstOrThrow({ where: { id: ctx.company.id }, select: { allowNegativeStock: true } }),
  ]);
  const stock = await ctx.db.stockLevel.groupBy({ by: ["warehouseId"], _sum: { quantity: true } });
  const byWh = new Map(stock.map((s) => [s.warehouseId, Number(s._sum.quantity ?? 0)]));
  return (
    <WarehousesPanel
      canManageWarehouses={ctx.can("inventory.warehouse.manage")}
      canManageCategories={ctx.can("inventory.product.update")}
      allowNegativeStock={company.allowNegativeStock}
      warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, code: w.code, address: w.address ?? "", isDefault: w.isDefault, isActive: w.isActive, units: byWh.get(w.id) ?? 0 }))}
      categories={categories.map((c) => ({ id: c.id, name: c.name, products: c._count.products }))}
    />
  );
}
