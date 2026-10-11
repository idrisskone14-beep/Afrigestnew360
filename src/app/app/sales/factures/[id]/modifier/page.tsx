import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { requirePagePermission } from "@/core/tenant/guards";
import { getInvoice } from "@/modules/sales/invoices";
import { toEditorLines, toInputDate } from "@/modules/sales/ui/editor-data";
import { SalesEditor } from "@/modules/sales/ui/sales-editor";
import { loadSalesEditorData } from "@/modules/sales/ui/sales-editor-data";

export const metadata: Metadata = { title: "Modifier la facture" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("finance.invoice.update");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const i = await getInvoice(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  if (i.status !== "DRAFT") redirect(`/app/sales/factures/${id}`);
  const data = await loadSalesEditorData(ctx);
  return (
    <SalesEditor
      kind="invoice" id={id} number={i.number} currency={i.currency} {...data}
      initial={{ customerId: i.customerId, date: toInputDate(i.issueDate), secondDate: toInputDate(i.dueDate), notes: i.notes ?? "", terms: i.terms ?? "", branchId: i.branchId ?? "", costCenterId: i.costCenterId ?? "", projectId: i.projectId ?? "", lines: toEditorLines(i.lines) }}
    />
  );
}
