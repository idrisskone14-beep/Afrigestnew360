import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { DocumentEditor } from "@/modules/sales/ui/document-editor";
import { emptyInitial, loadEditorData } from "@/modules/sales/ui/editor-data";

export const metadata: Metadata = { title: "Nouvelle facture" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("finance.invoice.create");
  const sp = await searchParams;
  const data = await loadEditorData(ctx);
  const customerId = data.customers.find((c) => c.id === param(sp, "client"))?.id ?? "";
  return <DocumentEditor kind="invoice" currency={ctx.company.currency} initial={emptyInitial({ customerId })} {...data} />;
}
