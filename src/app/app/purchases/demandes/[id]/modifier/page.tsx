import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { toInputDate } from "@/lib/format";
import { getRequest } from "@/modules/purchasing/procurement";
import { RequestEditor } from "@/modules/purchasing/ui/request-editor";

export const metadata: Metadata = { title: "Modifier la demande d'achat" };

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.request.create");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const r = await getRequest(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  if (r.status !== "DRAFT") redirect(`/app/purchases/demandes/${id}`);
  const products = ctx.hasModule("inventory") ? await ctx.db.product.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, sku: true, unit: true, costPrice: true }, orderBy: { name: "asc" }, take: 1000 }) : [];
  return (
    <RequestEditor
      id={id} currency={r.currency}
      products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, costPrice: num(p.costPrice) }))}
      initial={{ neededBy: toInputDate(r.neededBy), reason: r.reason ?? "", lines: r.lines.map((l) => ({ productId: l.productId ?? "", description: l.description, unit: l.unit, quantity: num(l.quantity), estimatedPrice: num(l.estimatedPrice) })) }}
    />
  );
}
