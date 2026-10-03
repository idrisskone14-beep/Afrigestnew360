import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listCategories, listProducts, listWarehouses } from "@/modules/inventory/service";
import { ProductFormDialog } from "@/modules/inventory/ui/product-form";
import { listTaxes } from "@/modules/settings/config";

export const metadata: Metadata = { title: "Produits" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("inventory.product.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const type = enumParam(sp, "type", ["GOODS", "SERVICE"] as const);
  const categories = await listCategories(ctx);
  const categoryId = categories.find((c) => c.id === param(sp, "categorie"))?.id;
  const { rows, total } = await listProducts(ctx, { q: lp.q, type, categoryId, skip: lp.skip, take: lp.take });
  const canCreate = ctx.can("inventory.product.create");
  const [warehouses, taxes] = canCreate ? await Promise.all([listWarehouses(ctx), listTaxes(ctx)]) : [[], []];
  const showStock = ctx.can("inventory.stock.read");
  const cur = ctx.company.currency;

  return (
    <>
      <ListToolbar
        placeholder="Nom, référence ou code-barres…"
        filters={[
          { name: "type", label: "Type", options: [{ value: "GOODS", label: "Produits" }, { value: "SERVICE", label: "Services" }] },
          ...(categories.length ? [{ name: "categorie", label: "Catégorie", options: categories.map((c) => ({ value: c.id, label: c.name })) }] : []),
        ]}
      >
        {canCreate && <ProductFormDialog categories={categories} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} taxes={taxes.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, rate: num(t.rate), isDefault: t.isDefault }))} />}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<Package className="size-8" />} title={lp.q ? "Aucun produit trouvé" : "Aucun produit"} description={lp.q ? "Essayez une autre recherche." : "Créez vos produits et services pour les utiliser dans vos devis, factures et achats."} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Produit</TableHead><TableHead className="hidden md:table-cell">Catégorie</TableHead><TableHead className="text-right">Prix HT</TableHead>{showStock && <TableHead className="text-right">Stock</TableHead>}<TableHead className="hidden sm:table-cell">Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((p) => {
                const avail = p.stock.quantity.minus(p.stock.reserved);
                const low = p.trackStock && p.minStock.gt(0) && avail.lte(p.minStock);
                return (
                  <TableRow key={p.id}>
                    <TableCell><Link href={`/app/inventory/produits/${p.id}`} className="block min-w-0 hover:text-brand"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.sku}{p.type === "SERVICE" ? " · Service" : ""}</span></Link></TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{p.category?.name ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular">{formatMoney(num(p.salePrice), cur)}</TableCell>
                    {showStock && (
                      <TableCell className="text-right text-sm tabular">
                        {p.trackStock ? <span className={low ? "font-semibold text-destructive" : ""}>{p.stock.quantity.toString()} {p.unit}{p.stock.reserved.gt(0) ? <span className="block text-xs font-normal text-muted-foreground">dont {p.stock.reserved.toString()} réservé</span> : null}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    <TableCell className="hidden sm:table-cell">{low ? <StatusBadge tone="danger">Stock bas</StatusBadge> : <StatusBadge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "Actif" : "Inactif"}</StatusBadge>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/inventory/produits" searchParams={sp} />
    </>
  );
}
