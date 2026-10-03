import type { Metadata } from "next";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { RequestEditor } from "@/modules/purchasing/ui/request-editor";

export const metadata: Metadata = { title: "Nouvelle demande d'achat" };

export default async function NewRequestPage() {
  const ctx = await requirePagePermission("purchases.request.create");
  const products = ctx.hasModule("inventory") ? await ctx.db.product.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, sku: true, unit: true, costPrice: true }, orderBy: { name: "asc" }, take: 1000 }) : [];
  return <RequestEditor currency={ctx.company.currency} initial={{ neededBy: "", reason: "", lines: [] }} products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, costPrice: num(p.costPrice) }))} />;
}
