import "server-only";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { toInputDate, todayInput } from "@/lib/format";
import type { EditorInitial, ProductOpt, TaxOpt } from "./document-editor";

/** Données de référence de l'éditeur de documents : clients, produits, taxes, entrepôts (toutes isolées par entreprise). */
export async function loadEditorData(ctx: TenantContext, opts: { parties?: "customers" | "suppliers" } = {}) {
  const [customers, products, taxes, warehouses, branches, costCenters, projects] = await Promise.all([
    opts.parties === "suppliers"
      ? ctx.db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 })
      : ctx.db.customer.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 }),
    ctx.can("inventory.product.read") || ctx.hasModule("inventory")
      ? ctx.db.product.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, sku: true, unit: true, salePrice: true, costPrice: true, taxId: true }, orderBy: { name: "asc" }, take: 1000 })
      : Promise.resolve([]),
    ctx.db.tax.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    ctx.hasModule("inventory") ? ctx.db.warehouse.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ctx.db.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.costCenter.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, code: true }, orderBy: { code: "asc" } }),
    ctx.hasModule("projects") && ctx.can("project.project.read") ? ctx.db.project.findMany({ where: { deletedAt: null, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  return {
    customers,
    products: products.map((p): ProductOpt => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, salePrice: num(p.salePrice), costPrice: num(p.costPrice), taxId: p.taxId })),
    taxes: taxes.map((t): TaxOpt => ({ id: t.id, name: t.name, rate: num(t.rate), isDefault: t.isDefault })),
    warehouses,
    branches,
    projects: projects.map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` })),
    costCenters: costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` })),
  };
}

type SrcLine = { productId: string | null; description: string; unit: string; quantity: unknown; unitPrice: unknown; discountPct: unknown; taxId: string | null };
export const toEditorLines = (lines: SrcLine[]): EditorInitial["lines"] =>
  lines.map((l) => ({ productId: l.productId ?? "", description: l.description, unit: l.unit, quantity: num(l.quantity as number), unitPrice: num(l.unitPrice as number), discountPct: num(l.discountPct as number), taxId: l.taxId ?? "" }));

export const emptyInitial = (over: Partial<EditorInitial> = {}): EditorInitial => ({ customerId: "", date: todayInput(), secondDate: "", notes: "", terms: "", lines: [], ...over });
export { toInputDate };
