import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { deletePriceListAction } from "@/modules/sales/actions";
import { getPriceList } from "@/modules/sales/price-lists";
import { PriceListEditor } from "@/modules/sales/ui/price-list-ui";

export const metadata: Metadata = { title: "Liste de prix" };

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("sales.pricelist.manage");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const list = await getPriceList(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const products = await ctx.db.product.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, sku: true, unit: true, salePrice: true }, orderBy: { name: "asc" }, take: 2000 });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/sales/listes-de-prix" className="hover:text-foreground">Listes de prix</Link> / {list.name}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{list.name}</h2>
        </div>
        <ActionButton action={deletePriceListAction} input={{ id: list.id }} variant="outline" label="Supprimer la liste" icon={<Trash2 className="size-4" />} redirectTo="/app/sales/listes-de-prix" success="Liste supprimée" confirm={{ title: "Supprimer cette liste ?", description: `${list.customers.length} client(s) y sont rattachés : ils repasseront au prix standard.`, confirmLabel: "Supprimer" }} />
      </div>
      <PriceListEditor
        id={list.id} name={list.name} description={list.description ?? ""} isActive={list.isActive} currency={ctx.company.currency}
        products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, salePrice: num(p.salePrice) }))}
        initial={list.items.map((i) => ({ productId: i.productId, price: num(i.price) }))}
      />
      {list.customers.length > 0 && (
        <section aria-label="Clients de la liste" className="rounded-xl border bg-card p-4 text-sm">
          <h3 className="mb-2 font-semibold">Clients rattachés ({list.customers.length})</h3>
          <p className="flex flex-wrap gap-x-4 gap-y-1">{list.customers.map((c) => <Link key={c.id} href={`/app/crm/clients/${c.id}`} className="text-brand hover:underline">{c.name}</Link>)}</p>
        </section>
      )}
    </div>
  );
}
