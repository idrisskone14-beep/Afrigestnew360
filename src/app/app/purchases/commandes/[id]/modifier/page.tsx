import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { requirePagePermission } from "@/core/tenant/guards";
import { getOrder } from "@/modules/purchasing/procurement";
import { DocumentEditor } from "@/modules/sales/ui/document-editor";
import { loadEditorData, toEditorLines, toInputDate } from "@/modules/sales/ui/editor-data";

export const metadata: Metadata = { title: "Modifier la commande fournisseur" };

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.order.update");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const o = await getOrder(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  if (o.status !== "DRAFT") redirect(`/app/purchases/commandes/${id}`);
  const data = await loadEditorData(ctx, { parties: "suppliers" });
  return (
    <DocumentEditor
      kind="purchase_order" id={id} currency={o.currency} {...data}
      initial={{ customerId: o.supplierId, date: toInputDate(o.orderDate), secondDate: toInputDate(o.expectedDate), notes: o.notes ?? "", terms: "", warehouseId: o.warehouseId ?? "", lines: toEditorLines(o.lines) }}
    />
  );
}
