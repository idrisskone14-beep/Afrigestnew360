import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { requirePagePermission } from "@/core/tenant/guards";
import { getOrder } from "@/modules/sales/orders";
import { DocumentEditor } from "@/modules/sales/ui/document-editor";
import { loadEditorData, toEditorLines, toInputDate } from "@/modules/sales/ui/editor-data";

export const metadata: Metadata = { title: "Modifier la commande" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("sales.order.update");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const o = await getOrder(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  if (o.status !== "DRAFT") redirect(`/app/sales/commandes/${id}`);
  const data = await loadEditorData(ctx);
  return (
    <DocumentEditor
      kind="order" id={id} currency={o.currency} {...data}
      initial={{ customerId: o.customerId, date: toInputDate(o.orderDate), secondDate: toInputDate(o.expectedDelivery), notes: o.notes ?? "", terms: "", warehouseId: o.warehouseId ?? "", lines: toEditorLines(o.lines) }}
    />
  );
}
