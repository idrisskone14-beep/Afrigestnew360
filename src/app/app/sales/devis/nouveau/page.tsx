import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { DocumentEditor } from "@/modules/sales/ui/document-editor";
import { emptyInitial, loadEditorData } from "@/modules/sales/ui/editor-data";

export const metadata: Metadata = { title: "Nouveau devis" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("sales.quote.create");
  const sp = await searchParams;
  const data = await loadEditorData(ctx);
  const customerId = data.customers.find((c) => c.id === param(sp, "client"))?.id ?? "";
  return <DocumentEditor kind="quote" currency={ctx.company.currency} initial={emptyInitial({ customerId, quoteKind: "QUOTE" })} {...data} />;
}
