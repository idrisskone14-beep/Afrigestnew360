import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, Boxes, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { listMovements, lowStockProducts, stockValuation } from "@/modules/inventory/service";

export const metadata: Metadata = { title: "Stock" };

const TYPE: Record<string, string> = { IN: "Entrée", OUT: "Sortie", TRANSFER: "Transfert", ADJUSTMENT: "Ajustement", RETURN: "Retour" };

export default async function InventoryOverview() {
  const ctx = await requireTenantContext();
  if (!ctx.can("inventory.stock.read")) redirect("/app/inventory/produits");
  const [products, warehouses, low, valuation, movements] = await Promise.all([
    ctx.db.product.count({ where: { deletedAt: null, isActive: true } }),
    ctx.db.warehouse.count({ where: { deletedAt: null, isActive: true } }),
    lowStockProducts(ctx, 8),
    stockValuation(ctx),
    ctx.can("inventory.movement.read") ? listMovements(ctx, { skip: 0, take: 8 }) : Promise.resolve({ rows: [], total: 0 }),
  ]);
  const cur = ctx.company.currency;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Boxes className="size-4" />} label="Produits actifs" value={String(products)} href="/app/inventory/produits" />
        <Kpi icon={<Wallet className="size-4" />} label="Valeur du stock" value={formatMoney(valuation.total.toNumber(), cur)} hint="Coût moyen pondéré" />
        <Kpi icon={<AlertTriangle className="size-4" />} label="Sous le seuil minimum" value={String(low.length)} hint="Produits à réapprovisionner" tone={low.length ? "warn" : undefined} />
        <Kpi icon={<ArrowLeftRight className="size-4" />} label="Entrepôts" value={String(warehouses)} href="/app/inventory/entrepots" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Alertes de stock</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {low.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun produit sous son seuil minimum.</p>}
            {low.map((p) => (
              <Link key={p.id} href={`/app/inventory/produits/${p.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku} · seuil {p.minStock.toString()} {p.unit}</p></div>
                <span className="tabular text-sm font-semibold text-destructive">{p.quantity.minus(p.reserved).toString()} {p.unit}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Derniers mouvements</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {movements.rows.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun mouvement.</p>}
            {movements.rows.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-6 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.product.name}</p><p className="text-xs text-muted-foreground">{TYPE[m.type]} · {m.warehouse.name} · {fmtDateTime(m.date)}</p></div>
                <span className={`tabular text-sm font-medium ${Number(m.quantity) < 0 ? "text-destructive" : "text-success"}`}>{Number(m.quantity) > 0 ? "+" : ""}{m.quantity.toString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint, href, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; href?: string; tone?: "warn" }) {
  const card = (
    <Card className={href ? "transition-colors hover:border-brand/50" : undefined}>
      <CardContent className="space-y-1 p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
        <div className={`truncate text-2xl font-semibold tracking-tight tabular ${tone === "warn" ? "text-warning" : ""}`}>{value}</div>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}
