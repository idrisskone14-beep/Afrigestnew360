import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { DocumentEditor } from "@/modules/sales/ui/document-editor";
import { emptyInitial, loadEditorData } from "@/modules/sales/ui/editor-data";

export const metadata: Metadata = { title: "Nouvelle facture fournisseur" };

export default async function NewBillPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("purchases.bill.create");
  const sp = await searchParams;
  const data = await loadEditorData(ctx, { parties: "suppliers" });
  const customerId = data.customers.find((s) => s.id === param(sp, "fournisseur"))?.id ?? "";
  return <DocumentEditor kind="supplier_bill" currency={ctx.company.currency} initial={emptyInitial({ customerId })} {...data} />;
}
