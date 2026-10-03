import "server-only";
import { forbidden, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { REPORTS, REPORT_BY_KEY } from "./catalog";
import { parseReportFilters, periodLabel } from "./filters";
import type { FilterKey, ReportDef, ReportFilters, ReportResult } from "./types";

type Ctx = TenantContext;
type Option = { id: string; name: string };

/** Un rapport est accessible si son module est actif et si l'utilisateur détient `reports.report.read` ET la lecture des données sources. */
export const canRunReport = (ctx: Pick<Ctx, "can" | "hasModule">, def: Pick<ReportDef, "module" | "permission">) =>
  ctx.hasModule("reports") && ctx.hasModule(def.module) && ctx.can("reports.report.read") && ctx.can(def.permission);

export const availableReports = (ctx: Pick<Ctx, "can" | "hasModule">) => REPORTS.filter((r) => canRunReport(ctx, r));

function assertReport(ctx: Ctx, key: string): ReportDef {
  const def = REPORT_BY_KEY.get(key);
  if (!def) throw notFound("Rapport");
  if (!canRunReport(ctx, def)) throw forbidden("Vous n'avez pas accès à ce rapport.");
  return def;
}

/** Libellés des filtres appliqués (imprimés dans les exports) ; un identifiant inconnu de l'entreprise est signalé, jamais résolu. */
async function describeFilters(ctx: Ctx, def: ReportDef, f: ReportFilters): Promise<[string, string][]> {
  const out: [string, string][] = [];
  if (def.filters.includes("period")) out.push(["Période", periodLabel(f)]);
  const name = async (label: string, id: string | undefined, find: (id: string) => Promise<{ name: string } | null>) => { if (id) out.push([label, (await find(id))?.name ?? "(introuvable)"]); };
  await name("Agence", f.branchId, (id) => ctx.db.branch.findFirst({ where: { id }, select: { name: true } }));
  await name("Département", f.departmentId, (id) => ctx.db.department.findFirst({ where: { id }, select: { name: true } }));
  await name("Centre de coûts", f.costCenterId, (id) => ctx.db.costCenter.findFirst({ where: { id }, select: { name: true } }));
  await name("Client", f.customerId, (id) => ctx.db.customer.findFirst({ where: { id }, select: { name: true } }));
  await name("Fournisseur", f.supplierId, (id) => ctx.db.supplier.findFirst({ where: { id }, select: { name: true } }));
  await name("Projet", f.projectId, (id) => ctx.db.project.findFirst({ where: { id }, select: { name: true } }));
  await name("Utilisateur", f.userId, async (id) => (await ctx.db.companyMembership.findFirst({ where: { userId: id }, select: { user: { select: { name: true } } } }))?.user ?? null);
  if (def.option && f.view) out.push([def.option.label, def.option.choices.find((c) => c.value === f.view)?.label ?? f.view]);
  return out;
}

/** Exécute un rapport après revérification complète des droits (module, lecture du rapport et des données sources). */
export async function buildReport(ctx: Ctx, key: string, get: (key: string) => string | undefined): Promise<{ def: ReportDef; filters: ReportFilters; result: ReportResult }> {
  const def = assertReport(ctx, key);
  const filters = parseReportFilters(def, get);
  const result = await def.run(ctx, filters);
  result.table.filters = await describeFilters(ctx, def, filters);
  if (result.truncated) result.table.subtitle = "résultat tronqué : affinez les filtres pour le détail complet";
  return { def, filters, result };
}

/** Listes proposées par les filtres (uniquement ceux que le rapport prend en charge). */
export async function filterOptions(ctx: Ctx, supported: FilterKey[]): Promise<Partial<Record<FilterKey, Option[]>>> {
  const has = (k: FilterKey) => supported.includes(k);
  const [branch, department, costCenter, customer, supplier, project, user] = await Promise.all([
    has("branch") ? ctx.db.branch.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : null,
    has("department") ? ctx.db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : null,
    has("costCenter") ? ctx.db.costCenter.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }) : null,
    has("customer") ? ctx.db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }) : null,
    has("supplier") ? ctx.db.supplier.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }) : null,
    has("project") ? ctx.db.project.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, code: true } }) : null,
    has("user") ? ctx.db.companyMembership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, user: { select: { name: true } } } }) : null,
  ]);
  return {
    ...(branch ? { branch } : {}), ...(department ? { department } : {}),
    ...(costCenter ? { costCenter: costCenter.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` })) } : {}),
    ...(customer ? { customer } : {}), ...(supplier ? { supplier } : {}),
    ...(project ? { project: project.map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` })) } : {}),
    ...(user ? { user: user.map((m) => ({ id: m.userId, name: m.user.name })).sort((a, b) => a.name.localeCompare(b.name, "fr")) } : {}),
  };
}
