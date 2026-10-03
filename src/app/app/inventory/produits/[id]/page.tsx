import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/app/status-badge";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { getProduct, listCategories, listWarehouses } from "@/modules/inventory/service";
import { ArchiveProductButton } from "@/modules/inventory/ui/archive-product-button";
import { MovementDialog } from "@/modules/inventory/ui/movement-dialog";
import { ProductFormDialog } from "@/modules/inventory/ui/product-form";
import { listTaxes } from "@/modules/settings/config";

export const metadata: Metadata = { title: "Fiche produit" };
const TYPE: Record<string, string> = { IN: "Entrée", OUT: "Sortie", TRANSFER: "Transfert", ADJUSTMENT: "Ajustement", RETURN: "Retour" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("inventory.product.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { product: p, levels, movements } = await getProduct(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const [categories, warehouses, taxes] = await Promise.all([listCategories(ctx), listWarehouses(ctx), listTaxes(ctx)]);
  const cur = ctx.company.currency;
  const total = levels.reduce((a, l) => a + num(l.quantity), 0);
  const reserved = levels.reduce((a, l) => a + num(l.reserved), 0);
  const showStock = ctx.can("inventory.stock.read") && p.trackStock;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/inventory/produits" className="hover:text-foreground">Produits</Link> / {p.sku}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{p.name}<StatusBadge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "Actif" : "Inactif"}</StatusBadge>{p.type === "SERVICE" && <StatusBadge>Service</StatusBadge>}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.trackStock && ctx.can("inventory.movement.create") && <MovementDialog defaultProductId={p.id} products={[{ id: p.id, name: p.name, sku: p.sku }]} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} canAdjust={ctx.can("inventory.stock.adjust")} />}
          {ctx.can("inventory.product.update") && (
            <ProductFormDialog
              productId={p.id} isActive={p.isActive} categories={categories} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} taxes={taxes.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, rate: num(t.rate), isDefault: t.isDefault }))}
              initial={{ sku: p.sku, name: p.name, description: p.description ?? "", type: p.type, categoryId: p.categoryId ?? "", unit: p.unit, barcode: p.barcode ?? "", salePrice: num(p.salePrice), costPrice: num(p.costPrice), taxId: p.taxId ?? "", trackStock: p.trackStock, minStock: num(p.minStock) }}
            />
          )}
          {ctx.can("inventory.product.delete") && <ArchiveProductButton productId={p.id} name={p.name} />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Prix de vente HT" value={formatMoney(num(p.salePrice), cur)} />
        {p.trackStock && <Stat label="Coût moyen" value={formatMoney(num(p.costPrice), cur)} hint="Coût moyen pondéré" />}
        {showStock && <Stat label="Stock total" value={`${total} ${p.unit}`} hint={reserved ? `dont ${reserved} réservé` : undefined} />}
        {showStock && <Stat label="Valeur du stock" value={formatMoney(total * num(p.costPrice), cur)} hint={p.minStock.gt(0) ? `Seuil minimum : ${num(p.minStock)} ${p.unit}` : undefined} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {showStock && (
          <Card>
            <CardHeader><CardTitle className="text-base">Stock par entrepôt</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
              {levels.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun stock enregistré.</p>}
              {levels.map((l) => <div key={l.id} className="flex justify-between px-6 py-3 text-sm"><span>{l.warehouse.name}</span><span className="tabular font-medium">{num(l.quantity)} {p.unit}{num(l.reserved) > 0 ? <span className="ml-2 text-xs font-normal text-muted-foreground">({num(l.reserved)} réservé)</span> : null}</span></div>)}
            </CardContent>
          </Card>
        )}
        {p.trackStock && ctx.can("inventory.movement.read") && (
          <Card>
            <CardHeader><CardTitle className="text-base">Historique des mouvements</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
              {movements.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun mouvement.</p>}
              {movements.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                  <div className="min-w-0 flex-1"><p>{TYPE[m.type]} · {m.warehouse.name}</p><p className="text-xs text-muted-foreground">{fmtDateTime(m.date)}{m.reason ? ` · ${m.reason}` : ""}{m.reference ? ` · ${m.reference}` : ""}</p></div>
                  <span className={`tabular font-medium ${num(m.quantity) < 0 ? "text-destructive" : "text-success"}`}>{num(m.quantity) > 0 ? "+" : ""}{num(m.quantity)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card><CardContent className="space-y-1 p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="truncate text-xl font-semibold tabular">{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</CardContent></Card>
);
