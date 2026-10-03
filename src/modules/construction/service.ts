import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, conflict, notFound } from "@/core/errors";
import { d, roundMoney } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import { recordMovement } from "@/modules/inventory/stock";
import { projectSchema } from "@/modules/projects/schemas";
import * as projects from "@/modules/projects/service";
import type { z } from "zod";
import type { budgetSchema, equipmentSchema, materialSchema, memberSchema, planSchema, reportSchema, siteSchema, subcontractSchema, updateSiteSchema, updateSubcontractSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const DAY = 86_400_000;
const todayUtc = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };
const iso = (dt: Date) => dt.toISOString().slice(0, 10);

export async function assertSite(db: Pick<Db, "constructionSite">, id: string, opts: { open?: boolean } = {}) {
  const s = await db.constructionSite.findFirst({ where: { id, deletedAt: null } });
  if (!s) throw notFound("Chantier");
  if (opts.open && (s.status === "DONE" || s.status === "CANCELLED")) throw businessRule(`Le chantier ${s.code} est ${s.status === "DONE" ? "terminé" : "annulé"} : rouvrez-le pour le modifier.`);
  return s;
}

// ═══ Chantiers ════════════════════════════════════════════════

export async function listSites(ctx: Ctx, p: { q?: string; status?: string; skip: number; take: number }) {
  const where = { deletedAt: null, ...(p.status ? { status: p.status as never } : {}), ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { code: { contains: p.q, mode: "insensitive" as const } }, { city: { contains: p.q, mode: "insensitive" as const } }] } : {}) };
  const [total, rows] = await Promise.all([ctx.db.constructionSite.count({ where }), ctx.db.constructionSite.findMany({ where, orderBy: [{ status: "asc" }, { code: "desc" }], skip: p.skip, take: p.take })]);
  return { total, rows };
}

export const getSite = (ctx: Ctx, id: string) => assertSite(ctx.db, id);

async function checkRefs(ctx: Ctx, input: { customerId?: string; managerId?: string; startDate?: string; endDate?: string }) {
  if (input.customerId && !(ctx.hasModule("crm") && (await ctx.db.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true } })))) throw notFound("Client");
  if (input.managerId && !(ctx.hasModule("hr") && (await ctx.db.employee.findFirst({ where: { id: input.managerId, deletedAt: null, status: "ACTIVE" }, select: { id: true } })))) throw notFound("Responsable");
  const s = parseDate(input.startDate), e = parseDate(input.endDate);
  if (s && e && e < s) throw businessRule("La fin du chantier précède son début.");
}

/**
 * Création d'un chantier : crée AUSSI le projet associé (même nom, client, responsable, dates). Dépenses, factures fournisseur et client, temps
 * passé rattachés à ce projet alimentent le chantier : un seul endroit de saisie, aucun double compte.
 */
export async function createSite(ctx: Ctx, input: z.output<typeof siteSchema>) {
  if (!ctx.hasModule("projects")) throw businessRule("Les chantiers s'appuient sur le module Projets, qui n'est pas activé.");
  await checkRefs(ctx, input);
  const project = await projects.createProject(ctx, projectSchema.parse({ name: input.name, description: input.description ?? "", customerId: input.customerId ?? "", managerId: input.managerId ?? "", status: "PLANNED", startDate: input.startDate ?? "", endDate: input.endDate ?? "", budget: 0, billRate: 0 }));
  const site = await ctx.tx(async (tx) => {
    const code = await nextNumber(tx, ctx.company.id, "site");
    return tx.constructionSite.create({
      data: { companyId: ctx.company.id, code, name: input.name.trim(), projectId: project.id, customerId: input.customerId || null, address: blank(input.address), city: blank(input.city), managerId: input.managerId || null, startDate: parseDate(input.startDate), endDate: parseDate(input.endDate), description: blank(input.description), createdById: ctx.user.id },
    });
  });
  await audit(ctx, { action: "construction.site.create", resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a créé le chantier ${site.code} « ${site.name} » (projet ${project.code}).` });
  return site;
}

export async function updateSite(ctx: Ctx, input: z.output<typeof updateSiteSchema>) {
  const before = await assertSite(ctx.db, input.id);
  await checkRefs(ctx, input);
  if (before.status === "DONE" && input.status === "CANCELLED") throw businessRule("Un chantier terminé ne peut pas être annulé.");
  // le projet change de statut EN PREMIER : il refuse « terminé » tant que des tâches sont ouvertes, et le chantier reste alors inchangé
  if (before.status !== input.status) await projects.setProjectStatus(ctx, before.projectId, input.status as never);
  const site = await ctx.tx(async (tx) => {
    const s = await tx.constructionSite.update({
      where: { id: input.id },
      data: { name: input.name.trim(), customerId: input.customerId || null, address: blank(input.address), city: blank(input.city), managerId: input.managerId || null, startDate: parseDate(input.startDate), endDate: parseDate(input.endDate), description: blank(input.description), status: input.status as never },
    });
    // le projet associé suit : mêmes nom, client, responsable et dates
    await tx.project.update({ where: { id: before.projectId }, data: { name: s.name, customerId: s.customerId, managerId: s.managerId, startDate: s.startDate, endDate: s.endDate, description: s.description } });
    return s;
  });
  await audit(ctx, { action: "construction.site.update", resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a modifié le chantier ${site.code}${before.status !== input.status ? ` (${before.status} → ${input.status})` : ""}.` });
  return site;
}

export async function archiveSite(ctx: Ctx, id: string) {
  const s = await assertSite(ctx.db, id);
  if (s.status === "ACTIVE") throw businessRule("Un chantier en cours ne peut pas être retiré : passez-le en pause, terminé ou annulé.");
  await ctx.db.constructionSite.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "construction.site.archive", resource: "ConstructionSite", resourceId: id, summary: `${ctx.user.name} a retiré le chantier ${s.code}.` });
}

// ═══ Budget ═══════════════════════════════════════════════════

export async function setBudget(ctx: Ctx, input: z.output<typeof budgetSchema>) {
  const site = await assertSite(ctx.db, input.siteId, { open: true });
  const seen = new Set<string>();
  for (const l of input.lines) { if (seen.has(l.category)) throw businessRule("Une catégorie de budget ne peut figurer qu'une fois."); seen.add(l.category); }
  await ctx.tx(async (tx) => {
    await tx.siteBudgetLine.deleteMany({ where: { siteId: site.id } });
    const lines = input.lines.filter((l) => l.amount > 0);
    if (lines.length) await tx.siteBudgetLine.createMany({ data: lines.map((l) => ({ companyId: ctx.company.id, siteId: site.id, category: l.category as never, amount: roundMoney(l.amount, ctx.company.currency).toString() })) });
    // le budget du projet associé est le total des lignes (suivi du « budget consommé » côté Projets)
    await tx.project.update({ where: { id: site.projectId }, data: { budget: roundMoney(lines.reduce((a, l) => a + l.amount, 0), ctx.company.currency).toString() } });
  });
  await audit(ctx, { action: "construction.budget.set", resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a défini le budget du chantier ${site.code} (${formatMoney(input.lines.reduce((a, l) => a + l.amount, 0), ctx.company.currency)}).`, after: input.lines });
}

// ═══ Équipe ═══════════════════════════════════════════════════

export async function addMember(ctx: Ctx, input: z.output<typeof memberSchema>) {
  const site = await assertSite(ctx.db, input.siteId, { open: true });
  if (!ctx.hasModule("hr")) throw businessRule("Le module Ressources humaines n'est pas activé.");
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } });
  if (!emp) throw notFound("Salarié");
  const start = parseDate(input.startDate)!;
  if (await ctx.db.siteMember.findFirst({ where: { siteId: site.id, employeeId: emp.id, OR: [{ endDate: null }, { endDate: { gte: start } }] }, select: { id: true } })) throw conflict(`${emp.firstName} ${emp.lastName} fait déjà partie de l'équipe sur cette période.`);
  const m = await ctx.db.siteMember.create({ data: { companyId: ctx.company.id, siteId: site.id, employeeId: emp.id, role: blank(input.role), startDate: start } });
  await audit(ctx, { action: "construction.member.add", resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a affecté ${emp.firstName} ${emp.lastName} au chantier ${site.code}.` });
  return m;
}

export async function endMember(ctx: Ctx, id: string) {
  const m = await ctx.db.siteMember.findFirst({ where: { id } });
  if (!m) throw notFound("Membre");
  if (m.endDate) throw businessRule("Cette affectation est déjà terminée.");
  await ctx.db.siteMember.update({ where: { id }, data: { endDate: todayUtc() < m.startDate ? m.startDate : todayUtc() } });
}

// ═══ Matériel et engins ═══════════════════════════════════════

export async function addEquipment(ctx: Ctx, input: z.output<typeof equipmentSchema>) {
  const site = await assertSite(ctx.db, input.siteId, { open: true });
  let name = input.name.trim();
  if (input.vehicleId) {
    if (!ctx.hasModule("fleet")) throw businessRule("Le module Transport & Flotte n'est pas activé.");
    const v = await ctx.db.vehicle.findFirst({ where: { id: input.vehicleId, deletedAt: null, status: "ACTIVE" }, select: { id: true, plate: true } });
    if (!v) throw notFound("Véhicule ou engin");
    const start = parseDate(input.startDate)!;
    const busy = await ctx.db.siteEquipment.findFirst({ where: { vehicleId: v.id, OR: [{ endDate: null }, { endDate: { gte: start } }] }, include: { site: { select: { code: true } } } });
    if (busy) throw businessRule(`${v.plate} est déjà affecté au chantier ${busy.site.code}.`);
    name = name || v.plate;
  }
  const e = await ctx.db.siteEquipment.create({ data: { companyId: ctx.company.id, siteId: site.id, vehicleId: input.vehicleId || null, name, dailyRate: roundMoney(input.dailyRate, ctx.company.currency).toString(), startDate: parseDate(input.startDate)! } });
  await audit(ctx, { action: "construction.equipment.add", resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a affecté « ${name} » au chantier ${site.code}.` });
  return e;
}

export async function endEquipment(ctx: Ctx, id: string) {
  const e = await ctx.db.siteEquipment.findFirst({ where: { id } });
  if (!e) throw notFound("Matériel");
  if (e.endDate) throw businessRule("Ce matériel est déjà libéré.");
  await ctx.db.siteEquipment.update({ where: { id }, data: { endDate: todayUtc() < e.startDate ? e.startDate : todayUtc() } });
}

// ═══ Matériaux (liés au stock) ════════════════════════════════

export async function setMaterialPlan(ctx: Ctx, input: z.output<typeof planSchema>) {
  const site = await assertSite(ctx.db, input.siteId, { open: true });
  if (!ctx.hasModule("inventory")) throw businessRule("Le module Stock n'est pas activé.");
  const p = await ctx.db.product.findFirst({ where: { id: input.productId, deletedAt: null, trackStock: true }, select: { id: true, name: true } });
  if (!p) throw notFound("Produit");
  await ctx.db.siteMaterialPlan.upsert({
    where: { siteId_productId: { siteId: site.id, productId: p.id } },
    create: { companyId: ctx.company.id, siteId: site.id, productId: p.id, plannedQty: input.plannedQty.toString() },
    update: { plannedQty: input.plannedQty.toString() },
  });
  await audit(ctx, { action: "construction.material.plan", resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a prévu ${input.plannedQty} × « ${p.name} » pour le chantier ${site.code}.` });
}

export async function removeMaterialPlan(ctx: Ctx, id: string) {
  const p = await ctx.db.siteMaterialPlan.findFirst({ where: { id } });
  if (!p) throw notFound("Ligne de matériaux");
  await ctx.db.siteMaterialPlan.delete({ where: { id } });
}

/** Quantité nette sortie du stock pour un produit sur un chantier (sorties − retours). */
async function netIssued(db: Pick<Db, "siteMaterialIssue">, siteId: string, productId: string) {
  const rows = await db.siteMaterialIssue.groupBy({ by: ["type"], where: { siteId, productId }, _sum: { quantity: true } });
  const sum = (t: string) => d(rows.find((r) => r.type === t)?._sum.quantity ?? 0);
  return sum("ISSUE").minus(sum("RETURN"));
}

/**
 * Sortie de matériaux du stock vers le chantier (ou retour au stock) : un VRAI mouvement de stock (disponible contrôlé, coût moyen), tracé
 * avec la référence du chantier ; le coût imputé est figé au coût moyen du moment. Un retour ne peut pas dépasser la quantité nette sortie.
 */
export async function moveMaterial(ctx: Ctx, input: z.output<typeof materialSchema>) {
  const site = await assertSite(ctx.db, input.siteId, { open: true });
  if (!ctx.hasModule("inventory")) throw businessRule("Le module Stock n'est pas activé.");
  const date = parseDate(input.date)!;
  if (date > new Date(todayUtc().getTime() + DAY)) throw businessRule("La date est dans le futur.");
  const issue = await ctx.tx(async (tx) => {
    // verrou sur le chantier : deux retours simultanés ne peuvent pas dépasser ensemble la quantité sortie
    await tx.$queryRaw`SELECT id FROM "ConstructionSite" WHERE id = ${site.id}::uuid FOR UPDATE`;
    const net = await netIssued(tx, site.id, input.productId);
    if (input.type === "RETURN" && d(input.quantity).gt(net)) throw businessRule(`Retour supérieur à la quantité sortie pour ce chantier (${net.toNumber()} en chantier).`);
    const product = await tx.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { costPrice: true, name: true } });
    if (!product) throw notFound("Produit");
    const cost = d(product.costPrice);
    const mv = await recordMovement(tx, ctx, input.type === "ISSUE"
      ? { productId: input.productId, warehouseId: input.warehouseId, type: "OUT", delta: d(input.quantity).neg(), sourceType: "construction_site", sourceId: site.id, reference: site.code, reason: `Sortie pour le chantier ${site.code}`, date }
      : { productId: input.productId, warehouseId: input.warehouseId, type: "RETURN", delta: d(input.quantity), unitCost: cost, skipCost: true, sourceType: "construction_site", sourceId: site.id, reference: site.code, reason: `Retour du chantier ${site.code}`, date });
    return tx.siteMaterialIssue.create({ data: { companyId: ctx.company.id, siteId: site.id, productId: input.productId, warehouseId: input.warehouseId, type: input.type, quantity: d(input.quantity).toString(), unitCost: cost.toString(), movementId: mv?.id ?? null, date, note: blank(input.note), createdById: ctx.user.id } });
  });
  await audit(ctx, { action: `construction.material.${input.type.toLowerCase()}`, resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a ${input.type === "ISSUE" ? "sorti" : "retourné"} ${input.quantity} unité(s) de matériaux ${input.type === "ISSUE" ? "pour" : "du"} chantier ${site.code}.` });
  return issue;
}

// ═══ Sous-traitants ═══════════════════════════════════════════

export async function addSubcontract(ctx: Ctx, input: z.output<typeof subcontractSchema>) {
  const site = await assertSite(ctx.db, input.siteId, { open: true });
  if (!(ctx.hasModule("purchases") && (await ctx.db.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null }, select: { id: true } })))) throw notFound("Fournisseur");
  const s = parseDate(input.startDate), e = parseDate(input.endDate);
  if (s && e && e < s) throw businessRule("La fin précède le début.");
  const sc = await ctx.db.siteSubcontract.create({ data: { companyId: ctx.company.id, siteId: site.id, supplierId: input.supplierId, scope: input.scope.trim(), contractAmount: roundMoney(input.contractAmount, ctx.company.currency).toString(), startDate: s, endDate: e, notes: blank(input.notes), status: "ACTIVE" } });
  await audit(ctx, { action: "construction.subcontract.add", resource: "ConstructionSite", resourceId: site.id, summary: `${ctx.user.name} a ajouté un sous-traitant au chantier ${site.code} (${input.scope}, ${formatMoney(input.contractAmount, ctx.company.currency)}).` });
  return sc;
}

export async function updateSubcontract(ctx: Ctx, input: z.output<typeof updateSubcontractSchema>) {
  const sc = await ctx.db.siteSubcontract.findFirst({ where: { id: input.id } });
  if (!sc) throw notFound("Sous-traitance");
  const s = parseDate(input.startDate), e = parseDate(input.endDate);
  if (s && e && e < s) throw businessRule("La fin précède le début.");
  await ctx.db.siteSubcontract.update({ where: { id: input.id }, data: { scope: input.scope.trim(), contractAmount: roundMoney(input.contractAmount, ctx.company.currency).toString(), startDate: s, endDate: e, status: input.status as never, notes: blank(input.notes) } });
}

// ═══ Rapports terrain ═════════════════════════════════════════

export async function listReports(ctx: Ctx, siteId: string) {
  return ctx.db.siteReport.findMany({ where: { siteId }, orderBy: { date: "desc" }, take: 100 });
}

/**
 * Rapport terrain du jour (un par chantier et par jour : une nouvelle saisie le même jour met à jour le rapport). L'avancement du chantier
 * suit le rapport le plus récent ; une date future est refusée. Photos et pièces : module Documents (liées au rapport).
 */
export async function saveReport(ctx: Ctx, input: z.output<typeof reportSchema>) {
  const site = await assertSite(ctx.db, input.siteId, { open: true });
  const date = parseDate(input.date)!;
  if (date >= new Date(todayUtc().getTime() + DAY)) throw businessRule("Un rapport ne peut pas être daté du futur.");
  if (site.startDate && date < site.startDate) throw businessRule("Le rapport précède le début du chantier.");
  const report = await ctx.tx(async (tx) => {
    const r = await tx.siteReport.upsert({
      where: { siteId_date: { siteId: site.id, date } },
      create: { companyId: ctx.company.id, siteId: site.id, date, authorId: ctx.user.id, weather: blank(input.weather), workforce: input.workforce, summary: input.summary.trim(), progress: input.progress, incidents: blank(input.incidents) },
      update: { authorId: ctx.user.id, weather: blank(input.weather), workforce: input.workforce, summary: input.summary.trim(), progress: input.progress, incidents: blank(input.incidents) },
    });
    const latest = await tx.siteReport.findFirstOrThrow({ where: { siteId: site.id }, orderBy: { date: "desc" }, select: { progress: true } });
    await tx.constructionSite.update({ where: { id: site.id }, data: { progress: latest.progress } });
    return r;
  });
  await audit(ctx, { action: "construction.report.save", resource: "SiteReport", resourceId: report.id, summary: `${ctx.user.name} a saisi le rapport du ${iso(date)} du chantier ${site.code} (avancement ${input.progress} %).` });
  return report;
}

// ═══ Budget réel, avancement et rentabilité ═══════════════════

export interface SiteSummary {
  budget: Record<string, number>; actual: Record<string, number | null>; budgetTotal: number; actualTotal: number; usedPct: number | null; progress: number;
  /** Coût final prévisible si le rythme de dépense suit l'avancement (réel ÷ avancement) ; null sans avancement. */
  forecast: number | null; overrun: boolean; revenue: number | null; margin: number | null;
  materials: { productId: string; name: string; unit: string; planned: number; issued: number; cost: number }[];
  subcontracts: { id: string; supplierId: string; supplier: string; scope: string; status: string; contractAmount: number; billed: number | null; startDate: Date | null; endDate: Date | null }[];
  equipment: { id: string; name: string; vehicleId: string | null; dailyRate: number; startDate: Date; endDate: Date | null; days: number; cost: number }[];
  team: { id: string; employeeId: string; name: string; role: string | null; startDate: Date; endDate: Date | null; hours: number }[];
}

/**
 * Budget prévu / réel par catégorie : matériaux = sorties de stock valorisées, main-d'œuvre = temps passé sur le projet associé,
 * matériel = jours × tarif, sous-traitance = factures des sous-traitants rattachées au projet, autres = dépenses payées et autres factures
 * rattachées. Les montants que l'utilisateur ne peut pas lire (finance, achats, ventes) sont absents (null), jamais estimés.
 */
export async function siteSummary(ctx: Ctx, siteId: string): Promise<SiteSummary> {
  const site = await assertSite(ctx.db, siteId);
  const pid = site.projectId;
  const canExp = ctx.hasModule("finance") && ctx.can("finance.expense.read");
  const canBill = ctx.hasModule("purchases") && ctx.can("purchases.bill.read");
  const canInv = ctx.hasModule("sales") && ctx.can("finance.invoice.read");
  const today = todayUtc();
  const [lines, plan, issues, equipment, members, subs, time, exps, bills, invs] = await Promise.all([
    ctx.db.siteBudgetLine.findMany({ where: { siteId } }),
    ctx.db.siteMaterialPlan.findMany({ where: { siteId } }),
    ctx.db.siteMaterialIssue.findMany({ where: { siteId } }),
    ctx.db.siteEquipment.findMany({ where: { siteId }, orderBy: { startDate: "desc" } }),
    ctx.db.siteMember.findMany({ where: { siteId }, orderBy: { startDate: "desc" } }),
    ctx.db.siteSubcontract.findMany({ where: { siteId }, orderBy: { startDate: "desc" } }),
    ctx.db.timeEntry.findMany({ where: { projectId: pid }, select: { employeeId: true, hours: true, costRate: true } }),
    canExp ? ctx.db.expense.aggregate({ where: { projectId: pid, status: "PAID" }, _sum: { amount: true } }) : Promise.resolve(null),
    canBill ? ctx.db.supplierBill.findMany({ where: { projectId: pid, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, select: { supplierId: true, subtotal: true, discountTotal: true } }) : Promise.resolve(null),
    canInv ? ctx.db.invoice.aggregate({ where: { projectId: pid, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, _sum: { subtotal: true, discountTotal: true } }) : Promise.resolve(null),
  ]);
  const labour = time.reduce((a, t) => a.plus(d(t.hours).mul(t.costRate)), d(0));
  const products = await ctx.db.product.findMany({ where: { id: { in: [...new Set([...plan.map((p) => p.productId), ...issues.map((i) => i.productId)])] } }, select: { id: true, name: true, unit: true } });
  const pname = new Map(products.map((p) => [p.id, p]));

  const materialRows = [...new Set([...plan.map((p) => p.productId), ...issues.map((i) => i.productId)])].map((productId) => {
    const mine = issues.filter((i) => i.productId === productId);
    const sign = (i: (typeof mine)[number]) => (i.type === "ISSUE" ? 1 : -1);
    return {
      productId, name: pname.get(productId)?.name ?? "Produit", unit: pname.get(productId)?.unit ?? "", planned: d(plan.find((p) => p.productId === productId)?.plannedQty ?? 0).toNumber(),
      issued: mine.reduce((a, i) => a + sign(i) * d(i.quantity).toNumber(), 0), cost: mine.reduce((a, i) => a + sign(i) * d(i.quantity).mul(i.unitCost).toNumber(), 0),
    };
  });
  const materials = materialRows.reduce((a, m) => a + m.cost, 0);
  const equipRows = equipment.map((e) => {
    const end = e.endDate && e.endDate < today ? e.endDate : today;
    const days = end < e.startDate ? 0 : Math.round((end.getTime() - e.startDate.getTime()) / DAY) + 1;
    return { id: e.id, name: e.name, vehicleId: e.vehicleId, dailyRate: d(e.dailyRate).toNumber(), startDate: e.startDate, endDate: e.endDate, days, cost: d(e.dailyRate).mul(days).toNumber() };
  });
  const subIds = new Set(subs.map((s) => s.supplierId));
  const billNet = (b: { subtotal: unknown; discountTotal: unknown }) => d(b.subtotal as number).minus(d(b.discountTotal as number)).toNumber();
  const billedBy = (supplierId: string) => (bills ? bills.filter((b) => b.supplierId === supplierId).reduce((a, b) => a + billNet(b), 0) : null);
  const suppliers = await ctx.db.supplier.findMany({ where: { id: { in: [...subIds] } }, select: { id: true, name: true } });
  const sname = new Map(suppliers.map((s) => [s.id, s.name]));
  const subTotal = bills ? bills.filter((b) => subIds.has(b.supplierId)).reduce((a, b) => a + billNet(b), 0) : null;
  const otherBills = bills ? bills.filter((b) => !subIds.has(b.supplierId)).reduce((a, b) => a + billNet(b), 0) : null;
  const other = exps === null && otherBills === null ? null : d(exps?._sum.amount ?? 0).toNumber() + (otherBills ?? 0);

  const budget: Record<string, number> = { MATERIALS: 0, LABOUR: 0, EQUIPMENT: 0, SUBCONTRACT: 0, OTHER: 0 };
  for (const l of lines) budget[l.category] = d(l.amount).toNumber();
  const actual: Record<string, number | null> = { MATERIALS: Math.round(materials * 100) / 100, LABOUR: Math.round(labour.toNumber() * 100) / 100, EQUIPMENT: Math.round(equipRows.reduce((a, e) => a + e.cost, 0) * 100) / 100, SUBCONTRACT: subTotal, OTHER: other };
  const budgetTotal = Object.values(budget).reduce((a, b) => a + b, 0);
  const actualTotal = Math.round(Object.values(actual).reduce<number>((a, b) => a + (b ?? 0), 0) * 100) / 100;
  const revenue = invs === null ? null : d(invs._sum.subtotal ?? 0).minus(invs._sum.discountTotal ?? 0).toNumber();
  const forecast = site.progress > 0 ? Math.round((actualTotal * 100) / site.progress) : null;
  const hoursByEmp = new Map<string, number>();
  for (const t of time) hoursByEmp.set(t.employeeId, d(hoursByEmp.get(t.employeeId) ?? 0).plus(t.hours).toNumber());
  const emps = await ctx.db.employee.findMany({ where: { id: { in: members.map((m) => m.employeeId) } }, select: { id: true, firstName: true, lastName: true } });
  const ename = new Map(emps.map((e) => [e.id, `${e.lastName} ${e.firstName}`]));
  return {
    budget, actual, budgetTotal, actualTotal, usedPct: budgetTotal > 0 ? Math.round((actualTotal / budgetTotal) * 1000) / 10 : null, progress: site.progress, forecast,
    overrun: budgetTotal > 0 && (actualTotal > budgetTotal || (forecast !== null && forecast > budgetTotal)), revenue, margin: revenue === null ? null : Math.round((revenue - actualTotal) * 100) / 100,
    materials: materialRows, equipment: equipRows,
    subcontracts: subs.map((s) => ({ id: s.id, supplierId: s.supplierId, supplier: sname.get(s.supplierId) ?? "Fournisseur", scope: s.scope, status: s.status, contractAmount: d(s.contractAmount).toNumber(), billed: billedBy(s.supplierId), startDate: s.startDate, endDate: s.endDate })),
    team: members.map((m) => ({ id: m.id, employeeId: m.employeeId, name: ename.get(m.employeeId) ?? "Salarié", role: m.role, startDate: m.startDate, endDate: m.endDate, hours: hoursByEmp.get(m.employeeId) ?? 0 })),
  };
}
