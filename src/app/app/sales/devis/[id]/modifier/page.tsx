import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { requirePagePermission } from "@/core/tenant/guards";
import { getQuote } from "@/modules/sales/quotes";
import { toEditorLines, toInputDate } from "@/modules/sales/ui/editor-data";
import { SalesEditor } from "@/modules/sales/ui/sales-editor";
import { loadSalesEditorData } from "@/modules/sales/ui/sales-editor-data";

export const metadata: Metadata = { title: "Modifier le devis" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("sales.quote.update");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const q = await getQuote(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  if (!["DRAFT", "SENT"].includes(q.status)) redirect(`/app/sales/devis/${id}`);
  const data = await loadSalesEditorData(ctx);
  return (
    <SalesEditor kind="quote"
      id={id} number={q.number} currency={q.currency} {...data}
      initial={{ customerId: q.customerId, date: toInputDate(q.issueDate), secondDate: toInputDate(q.validUntil), notes: q.notes ?? "", terms: q.terms ?? "", quoteKind: q.kind, lines: toEditorLines(q.lines) }}
    />
  );
}
