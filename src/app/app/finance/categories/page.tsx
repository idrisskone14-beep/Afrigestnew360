import type { Metadata } from "next";
import { requireTenantContext } from "@/core/tenant/guards";
import { forbidden } from "next/navigation";
import { listCategories } from "@/modules/finance/treasury";
import { CategoriesPanel } from "@/modules/finance/ui/categories-panel";

export const metadata: Metadata = { title: "Catégories financières" };

export default async function CategoriesPage() {
  const ctx = await requireTenantContext();
  if (!ctx.can("finance.account.read") && !ctx.can("finance.category.manage")) forbidden();
  const categories = await listCategories(ctx, { includeInactive: true });
  return <CategoriesPanel canManage={ctx.can("finance.category.manage")} categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, isActive: c.isActive }))} />;
}
