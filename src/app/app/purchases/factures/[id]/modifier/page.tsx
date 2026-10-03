import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { requirePagePermission } from "@/core/tenant/guards";
import { getBill } from "@/modules/purchasing/bills";
import { DocumentEditor } from "@/modules/sales/ui/document-editor";
import { loadEditorData, toEditorLines, toInputDate } from "@/modules/sales/ui/editor-data";

export const metadata: Metadata = { title: "Modifier la facture fournisseur" };

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.bill.update");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const b = await getBill(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  if (b.status !== "DRAFT") redirect(`/app/purchases/factures/${id}`);
  const data = await loadEditorData(ctx, { parties: "suppliers" });
  return (
    <DocumentEditor
      kind="supplier_bill" id={id} currency={b.currency} {...data}
      initial={{ customerId: b.supplierId, date: toInputDate(b.billDate), secondDate: toInputDate(b.dueDate), notes: b.notes ?? "", terms: "", reference: b.supplierRef ?? "", branchId: b.branchId ?? "", costCenterId: b.costCenterId ?? "", projectId: b.projectId ?? "", lines: toEditorLines(b.lines) }}
    />
  );
}
