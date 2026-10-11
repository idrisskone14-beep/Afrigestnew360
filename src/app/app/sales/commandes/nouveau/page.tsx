import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { emptyInitial } from "@/modules/sales/ui/editor-data";
import { SalesEditor } from "@/modules/sales/ui/sales-editor";
import { loadSalesEditorData } from "@/modules/sales/ui/sales-editor-data";

export const metadata: Metadata = { title: "Nouvelle commande" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("sales.order.create");
  const sp = await searchParams;
  const data = await loadSalesEditorData(ctx);
  const customerId = data.customers.find((c) => c.id === param(sp, "client"))?.id ?? "";
  return <SalesEditor kind="order" currency={ctx.company.currency} initial={emptyInitial({ customerId })} {...data} />;
}
