import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("inventory");
  const tabs = [
    { href: "/app/inventory", label: "Vue d'ensemble", exact: true, show: ctx.can("inventory.stock.read") || ctx.can("inventory.product.read") },
    { href: "/app/inventory/produits", label: "Produits", show: ctx.can("inventory.product.read") },
    { href: "/app/inventory/mouvements", label: "Mouvements", show: ctx.can("inventory.movement.read") },
    { href: "/app/inventory/inventaire", label: "Inventaire", show: ctx.can("inventory.count.manage") },
    { href: "/app/inventory/entrepots", label: "Entrepôts & catégories", show: ctx.can("inventory.product.read") || ctx.can("inventory.warehouse.manage") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Stock & Inventaire" description="Produits, entrepôts, mouvements traçables et alertes de seuil." />
      <TabNav tabs={tabs} label="Sections du stock" />
      {children}
    </>
  );
}
