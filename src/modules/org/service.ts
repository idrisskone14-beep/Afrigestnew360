import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";
import { d, type Decimal } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import type { branchSchema, costCenterSchema, departmentSchema, siteSchema, updateBranchSchema, updateCostCenterSchema, updateDepartmentSchema, updateSiteSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const codeOrNull = (v?: string | null) => (v && v.trim() ? v.trim().toUpperCase() : null);

/**
 * Vérifie que les références d'organisation fournies par un client existent bien DANS l'entreprise active
 * (jamais l'identifiant d'une autre entreprise) et sont actives. À appeler par tout service qui stocke ces identifiants.
 */
export async function assertOrgRefs(db: Pick<Db, "branch" | "costCenter" | "department">, refs: { branchId?: string | null; costCenterId?: string | null; departmentId?: string | null }) {
  if (refs.branchId && !(await db.branch.findFirst({ where: { id: refs.branchId, deletedAt: null, isActive: true }, select: { id: true } }))) throw notFound("Agence");
  if (refs.costCenterId && !(await db.costCenter.findFirst({ where: { id: refs.costCenterId, deletedAt: null, isActive: true }, select: { id: true } }))) throw notFound("Centre de coûts");
  if (refs.departmentId && !(await db.department.findFirst({ where: { id: refs.departmentId, deletedAt: null, isActive: true }, select: { id: true } }))) throw notFound("Département");
}

// ═══ Agences ══════════════════════════════════════════════════

export const listBranches = (ctx: Ctx, includeInactive = true) => ctx.db.branch.findMany({ where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ isHeadquarters: "desc" }, { name: "asc" }] });

async function onlyHeadquarters(tx: Db, companyId: string, id: string) {
  await tx.branch.updateMany({ where: { companyId, id: { not: id }, isHeadquarters: true }, data: { isHeadquarters: false } });
}

async function assertUniqueBranchCode(ctx: Ctx, code: string | null, exceptId?: string) {
  if (code && (await ctx.db.branch.findFirst({ where: { code, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } }))) throw businessRule(`Le code d'agence « ${code} » est déjà utilisé.`);
}

export async function createBranch(ctx: Ctx, input: z.output<typeof branchSchema>) {
  const code = codeOrNull(input.code);
  await assertUniqueBranchCode(ctx, code);
  const b = await ctx.tx(async (tx) => {
    const created = await tx.branch.create({ data: { companyId: ctx.company.id, name: input.name.trim(), code, address: blank(input.address), city: blank(input.city), isHeadquarters: input.isHeadquarters, createdById: ctx.user.id } });
    if (created.isHeadquarters) await onlyHeadquarters(tx, ctx.company.id, created.id);
    return created;
  });
  await audit(ctx, { action: "org.branch.create", resource: "Branch", resourceId: b.id, summary: `${ctx.user.name} a créé l'agence « ${b.name} ».` });
  return b;
}

export async function updateBranch(ctx: Ctx, input: z.output<typeof updateBranchSchema>) {
  const before = await ctx.db.branch.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!before) throw notFound("Agence");
  const code = codeOrNull(input.code);
  await assertUniqueBranchCode(ctx, code, input.id);
  if (!input.isActive) await assertBranchArchivable(ctx, input.id);
  const after = await ctx.tx(async (tx) => {
    const b = await tx.branch.update({ where: { id: input.id }, data: { name: input.name.trim(), code, address: blank(input.address), city: blank(input.city), isHeadquarters: input.isHeadquarters, isActive: input.isActive } });
    if (b.isHeadquarters) await onlyHeadquarters(tx, ctx.company.id, b.id);
    return b;
  });
  await audit(ctx, { action: "org.branch.update", resource: "Branch", resourceId: after.id, summary: `${ctx.user.name} a modifié l'agence « ${after.name} ».`, before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive } });
  return after;
}

/** Une agence ne peut être désactivée tant que des salariés actifs y sont rattachés. */
async function assertBranchArchivable(ctx: Ctx, id: string) {
  const employees = ctx.hasModule("hr") ? await ctx.db.employee.count({ where: { branchId: id, status: { not: "TERMINATED" }, deletedAt: null } }) : 0;
  if (employees > 0) throw businessRule(`${employees} salarié${employees > 1 ? "s" : ""} actif${employees > 1 ? "s sont" : " est"} rattaché${employees > 1 ? "s" : ""} à cette agence : réaffectez-les d'abord.`);
}

// ═══ Sites ════════════════════════════════════════════════════

export const listSites = (ctx: Ctx) => ctx.db.site.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, include: { branch: { select: { id: true, name: true } } } });

export async function createSite(ctx: Ctx, input: z.output<typeof siteSchema>) {
  await assertOrgRefs(ctx.db, { branchId: input.branchId });
  const s = await ctx.db.site.create({ data: { companyId: ctx.company.id, name: input.name.trim(), type: blank(input.type), address: blank(input.address), branchId: input.branchId || null, createdById: ctx.user.id } });
  await audit(ctx, { action: "org.site.create", resource: "Site", resourceId: s.id, summary: `${ctx.user.name} a créé le site « ${s.name} ».` });
  return s;
}

export async function updateSite(ctx: Ctx, input: z.output<typeof updateSiteSchema>) {
  if (!(await ctx.db.site.findFirst({ where: { id: input.id, deletedAt: null } }))) throw notFound("Site");
  await assertOrgRefs(ctx.db, { branchId: input.branchId });
  const s = await ctx.db.site.update({ where: { id: input.id }, data: { name: input.name.trim(), type: blank(input.type), address: blank(input.address), branchId: input.branchId || null, isActive: input.isActive } });
  await audit(ctx, { action: "org.site.update", resource: "Site", resourceId: s.id, summary: `${ctx.user.name} a modifié le site « ${s.name} ».` });
  return s;
}

// ═══ Départements (arborescence) ══════════════════════════════

export const listDepartments = (ctx: Ctx) => ctx.db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });

/** Refuse un parent qui est le département lui-même ou l'un de ses descendants (cycle). */
async function assertNoCycle(ctx: Ctx, id: string, parentId: string | null) {
  let cur: string | null = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) throw businessRule("Un département ne peut pas dépendre de lui-même ni de l'un de ses sous-départements.");
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = (await ctx.db.department.findFirst({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
  }
}

export async function createDepartment(ctx: Ctx, input: z.output<typeof departmentSchema>) {
  const code = codeOrNull(input.code);
  if (code && (await ctx.db.department.findFirst({ where: { code, deletedAt: null } }))) throw businessRule(`Le code « ${code} » est déjà utilisé.`);
  if (input.parentId) await assertOrgRefs(ctx.db, { departmentId: input.parentId });
  const dep = await ctx.db.department.create({ data: { companyId: ctx.company.id, name: input.name.trim(), code, parentId: input.parentId || null, createdById: ctx.user.id } });
  await audit(ctx, { action: "org.department.create", resource: "Department", resourceId: dep.id, summary: `${ctx.user.name} a créé le département « ${dep.name} ».` });
  return dep;
}

export async function updateDepartment(ctx: Ctx, input: z.output<typeof updateDepartmentSchema>) {
  const before = await ctx.db.department.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!before) throw notFound("Département");
  const code = codeOrNull(input.code);
  if (code && (await ctx.db.department.findFirst({ where: { code, deletedAt: null, id: { not: input.id } } }))) throw businessRule(`Le code « ${code} » est déjà utilisé.`);
  if (input.parentId) { await assertOrgRefs(ctx.db, { departmentId: input.parentId }); await assertNoCycle(ctx, input.id, input.parentId); }
  if (!input.isActive && ctx.hasModule("hr")) {
    const n = await ctx.db.employee.count({ where: { departmentId: input.id, status: { not: "TERMINATED" }, deletedAt: null } });
    if (n > 0) throw businessRule(`${n} salarié${n > 1 ? "s" : ""} actif${n > 1 ? "s" : ""} dans ce département : réaffectez-les d'abord.`);
  }
  const dep = await ctx.db.department.update({ where: { id: input.id }, data: { name: input.name.trim(), code, parentId: input.parentId || null, isActive: input.isActive } });
  await audit(ctx, { action: "org.department.update", resource: "Department", resourceId: dep.id, summary: `${ctx.user.name} a modifié le département « ${dep.name} ».` });
  return dep;
}

// ═══ Centres de coûts ═════════════════════════════════════════

export const listCostCenters = (ctx: Ctx) => ctx.db.costCenter.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } });

export async function createCostCenter(ctx: Ctx, input: z.output<typeof costCenterSchema>) {
  const code = input.code.trim().toUpperCase();
  if (await ctx.db.costCenter.findFirst({ where: { code, deletedAt: null } })) throw businessRule(`Le centre de coûts « ${code} » existe déjà.`);
  const c = await ctx.db.costCenter.create({ data: { companyId: ctx.company.id, code, name: input.name.trim(), createdById: ctx.user.id } });
  await audit(ctx, { action: "org.cost_center.create", resource: "CostCenter", resourceId: c.id, summary: `${ctx.user.name} a créé le centre de coûts ${c.code} « ${c.name} ».` });
  return c;
}

export async function updateCostCenter(ctx: Ctx, input: z.output<typeof updateCostCenterSchema>) {
  if (!(await ctx.db.costCenter.findFirst({ where: { id: input.id, deletedAt: null } }))) throw notFound("Centre de coûts");
  const code = input.code.trim().toUpperCase();
  if (await ctx.db.costCenter.findFirst({ where: { code, deletedAt: null, id: { not: input.id } } })) throw businessRule(`Le centre de coûts « ${code} » existe déjà.`);
  const c = await ctx.db.costCenter.update({ where: { id: input.id }, data: { code, name: input.name.trim(), isActive: input.isActive } });
  await audit(ctx, { action: "org.cost_center.update", resource: "CostCenter", resourceId: c.id, summary: `${ctx.user.name} a modifié le centre de coûts ${c.code}.` });
  return c;
}

// ═══ Analyse par agence et centre de coûts ════════════════════

export interface OrgAnalysisRow { id: string | null; label: string; revenue: Decimal; purchases: Decimal; expenses: Decimal; result: Decimal }

/** Produits (factures émises, HT), achats (factures fournisseur validées, HT) et dépenses payées par agence et par centre de coûts. */
export async function orgAnalysis(ctx: Ctx, by: "branch" | "costCenter"): Promise<OrgAnalysisRow[]> {
  const key = by === "branch" ? "branchId" : "costCenterId";
  const canSales = ctx.hasModule("sales") && ctx.can("finance.invoice.read");
  const canPurchases = ctx.hasModule("purchases") && ctx.can("purchases.bill.read");
  const canExpenses = ctx.hasModule("finance") && ctx.can("finance.expense.read");
  const [inv, bills, exps, names] = await Promise.all([
    canSales ? ctx.db.invoice.groupBy({ by: [key], where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, _sum: { subtotal: true, discountTotal: true } }) : Promise.resolve([]),
    canPurchases ? ctx.db.supplierBill.groupBy({ by: [key], where: { status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, _sum: { subtotal: true, discountTotal: true } }) : Promise.resolve([]),
    canExpenses ? ctx.db.expense.groupBy({ by: [key], where: { status: "PAID" }, _sum: { amount: true } }) : Promise.resolve([]),
    by === "branch" ? ctx.db.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }) : ctx.db.costCenter.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true } }),
  ]);
  const label = new Map(names.map((n) => [n.id, "code" in n ? `${n.code} — ${n.name}` : n.name]));
  const idOf = (g: unknown) => (g as Record<string, string | null>)[key] ?? null;
  const rows = new Map<string | null, OrgAnalysisRow>();
  const row = (id: string | null) => {
    if (!rows.has(id)) rows.set(id, { id, label: id ? label.get(id) ?? "(supprimé)" : "Non affecté", revenue: d(0), purchases: d(0), expenses: d(0), result: d(0) });
    return rows.get(id)!;
  };
  for (const g of inv) { const r = row(idOf(g)); r.revenue = r.revenue.plus(d(g._sum.subtotal ?? 0).minus(g._sum.discountTotal ?? 0)); }
  for (const g of bills) { const r = row(idOf(g)); r.purchases = r.purchases.plus(d(g._sum.subtotal ?? 0).minus(g._sum.discountTotal ?? 0)); }
  for (const g of exps) { const r = row(idOf(g)); r.expenses = r.expenses.plus(g._sum.amount ?? 0); }
  for (const r of rows.values()) r.result = r.revenue.minus(r.purchases).minus(r.expenses);
  return [...rows.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.label.localeCompare(b.label)));
}
