import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { d, roundMoney } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { formatMoney } from "@/lib/reference-data";
import { workingDays } from "@/modules/hr/leave";
import type { z } from "zod";
import { computePayslip, type Bracket, type ExtraItem, type ItemDef } from "./calc";
import type { employeeItemSchema, payRunSchema, payrollItemSchema, runSchema } from "./schemas";

type Ctx = TenantContext;
const DAY = 86_400_000;
const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
const monthBounds = (year: number, month: number) => ({ start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0)) });
export const periodLabel = (year: number, month: number) => `${["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][month - 1]} ${year}`;

// ═══ Rubriques ════════════════════════════════════════════════

export const listItems = (ctx: Ctx) => ctx.db.payrollItem.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { effectiveFrom: "desc" }] });

/** Version applicable de chaque rubrique à une date (la plus récente dont la période d'effet couvre la date). */
export async function itemsAt(db: Pick<Db, "payrollItem">, at: Date): Promise<ItemDef[]> {
  const rows = await db.payrollItem.findMany({ where: { isActive: true, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] }, orderBy: { effectiveFrom: "desc" } });
  const byCode = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byCode.has(r.code)) byCode.set(r.code, r);
  return [...byCode.values()].map((r) => ({
    code: r.code, name: r.name, type: r.type, category: r.category, mode: r.mode, base: r.base, value: d(r.value), ceiling: r.ceiling ? d(r.ceiling) : null,
    brackets: Array.isArray(r.brackets) ? (r.brackets as unknown as Bracket[]) : null, taxable: r.taxable, deductibleForTax: r.deductibleForTax, sortOrder: r.sortOrder,
  }));
}

/**
 * Crée (ou met à jour, si la date d'effet est la même) une VERSION de rubrique. Une nouvelle version clôture la précédente la veille :
 * les campagnes déjà calculées ne changent pas, les suivantes utilisent le nouveau taux dès sa date d'effet.
 */
export async function saveItem(ctx: Ctx, input: z.output<typeof payrollItemSchema>) {
  const code = input.code.trim().toUpperCase();
  const from = day(parseDate(input.effectiveFrom)!);
  const data = {
    name: input.name.trim(), type: input.type, category: input.category, mode: input.mode, base: input.base, value: input.value,
    ceiling: input.ceiling === "" || input.ceiling === undefined ? null : input.ceiling, brackets: input.mode === "BRACKETS" ? JSON.parse(JSON.stringify(input.brackets ?? [])) : undefined,
    taxable: input.taxable, deductibleForTax: input.deductibleForTax, sortOrder: input.sortOrder,
  };
  const item = await ctx.tx(async (tx) => {
    const same = await tx.payrollItem.findFirst({ where: { code, effectiveFrom: from } });
    if (same) return tx.payrollItem.update({ where: { id: same.id }, data: { ...data, isActive: true } });
    const earlier = await tx.payrollItem.findFirst({ where: { code }, orderBy: { effectiveFrom: "desc" } });
    if (earlier && earlier.type !== input.type) throw businessRule(`Le code « ${code} » est déjà utilisé par une rubrique de type différent.`);
    const later = await tx.payrollItem.findFirst({ where: { code, effectiveFrom: { gt: from } } });
    if (later) throw businessRule("Une version plus récente de cette rubrique existe déjà : modifiez-la plutôt.");
    await tx.payrollItem.updateMany({ where: { code, effectiveFrom: { lt: from }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, data: { effectiveTo: new Date(from.getTime() - DAY) } });
    return tx.payrollItem.create({ data: { companyId: ctx.company.id, code, effectiveFrom: from, ...data } });
  });
  await audit(ctx, { action: "payroll.item.save", resource: "PayrollItem", resourceId: item.id, summary: `${ctx.user.name} a défini la rubrique de paie ${code} « ${item.name} » (effet au ${from.toISOString().slice(0, 10)}).`, after: { mode: item.mode, value: item.value, ceiling: item.ceiling } });
  return item;
}

export async function toggleItem(ctx: Ctx, id: string, isActive: boolean) {
  const it = await ctx.db.payrollItem.findFirst({ where: { id } });
  if (!it) throw notFound("Rubrique");
  await ctx.db.payrollItem.update({ where: { id }, data: { isActive } });
  await audit(ctx, { action: "payroll.item.toggle", resource: "PayrollItem", resourceId: id, summary: `${ctx.user.name} a ${isActive ? "réactivé" : "désactivé"} la rubrique ${it.code} (version du ${it.effectiveFrom.toISOString().slice(0, 10)}).` });
}

/** Modèle indicatif de départ. Les taux et barèmes sont des EXEMPLES à remplacer par ceux de votre pays et de votre convention collective. */
export async function installSampleItems(ctx: Ctx) {
  if ((await ctx.db.payrollItem.count()) > 0) throw businessRule("Des rubriques existent déjà.");
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  await ctx.db.payrollItem.createMany({
    data: [
      { companyId: ctx.company.id, code: "TRANSPORT", name: "Prime de transport (exemple)", type: "EARNING", mode: "FIXED", value: 20000, taxable: false, sortOrder: 10, effectiveFrom: from },
      { companyId: ctx.company.id, code: "RETRAITE_S", name: "Cotisation retraite salariale (taux d'exemple)", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", base: "GROSS", value: 6, deductibleForTax: true, sortOrder: 100, effectiveFrom: from },
      { companyId: ctx.company.id, code: "IMPOT", name: "Impôt sur salaire (barème d'exemple)", type: "DEDUCTION", category: "TAX", mode: "BRACKETS", base: "TAXABLE", sortOrder: 200, effectiveFrom: from, brackets: [{ upTo: 75000, rate: 0 }, { upTo: 240000, rate: 10 }, { upTo: null, rate: 20 }] },
      { companyId: ctx.company.id, code: "RETRAITE_P", name: "Cotisation retraite patronale (taux d'exemple)", type: "EMPLOYER", category: "SOCIAL", mode: "RATE", base: "GROSS", value: 8, sortOrder: 300, effectiveFrom: from },
      { companyId: ctx.company.id, code: "ALLOC_P", name: "Prestations familiales patronales (taux d'exemple)", type: "EMPLOYER", category: "SOCIAL", mode: "RATE", base: "GROSS", value: 5, ceiling: 70000, sortOrder: 310, effectiveFrom: from },
    ],
  });
  await audit(ctx, { action: "payroll.item.sample", resource: "PayrollItem", summary: `${ctx.user.name} a chargé le modèle indicatif de rubriques de paie.` });
}

// ═══ Éléments récurrents par salarié ══════════════════════════

export async function addEmployeeItem(ctx: Ctx, input: z.output<typeof employeeItemSchema>) {
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  if (emp.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs.");
  const start = day(parseDate(input.startDate)!);
  const end = parseDate(input.endDate) ? day(parseDate(input.endDate)!) : null;
  if (end && end < start) throw businessRule("La fin précède le début.");
  const it = await ctx.db.employeePayrollItem.create({ data: { companyId: ctx.company.id, employeeId: emp.id, name: input.name.trim(), type: input.type, category: input.type === "EARNING" ? "OTHER" : input.category, amount: roundMoney(input.amount, ctx.company.currency).toString(), taxable: input.taxable, startDate: start, endDate: end } });
  await audit(ctx, { action: "payroll.employee_item.create", resource: "EmployeePayrollItem", resourceId: it.id, summary: `${ctx.user.name} a ajouté « ${it.name} » (${formatMoney(d(it.amount).toNumber(), ctx.company.currency)}/mois) à ${emp.firstName} ${emp.lastName}.` });
  return it;
}

export async function removeEmployeeItem(ctx: Ctx, id: string) {
  const it = await ctx.db.employeePayrollItem.findFirst({ where: { id } });
  if (!it) throw notFound("Élément de paie");
  await ctx.db.employeePayrollItem.update({ where: { id }, data: { isActive: false } });
  await audit(ctx, { action: "payroll.employee_item.remove", resource: "EmployeePayrollItem", resourceId: id, summary: `${ctx.user.name} a retiré l'élément de paie « ${it.name} ».` });
}

// ═══ Campagnes ════════════════════════════════════════════════

export async function listRuns(ctx: Ctx) { return ctx.db.payrollRun.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }], include: { _count: { select: { payslips: true } } } }); }

export async function getRun(ctx: Ctx, id: string) {
  const r = await ctx.db.payrollRun.findFirst({ where: { id }, include: { payslips: { orderBy: { employee: { lastName: "asc" } }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, payoutMethod: true } } } } } });
  if (!r) throw notFound("Campagne de paie");
  return r;
}

async function assertRun(ctx: Ctx, id: string) { if (!(await ctx.db.payrollRun.findFirst({ where: { id }, select: { id: true } }))) throw notFound("Campagne de paie"); }

async function lockRun(tx: Db, id: string) { await tx.$queryRaw`SELECT "id" FROM "PayrollRun" WHERE "id" = ${id}::uuid FOR UPDATE`; }

/** Calcule (ou recalcule) tous les bulletins d'une campagne en brouillon. */
async function calculate(tx: Db, ctx: Ctx, runId: string) {
  const run = await tx.payrollRun.findFirstOrThrow({ where: { id: runId } });
  if (run.status !== "DRAFT") throw businessRule("Seule une campagne en brouillon se calcule.");
  const { start, end } = monthBounds(run.year, run.month);
  const items = await itemsAt(tx, end);
  const monthWorkdays = workingDays(start, end);
  const employees = await tx.employee.findMany({ where: { deletedAt: null, hireDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  await tx.payslip.deleteMany({ where: { runId } });
  let tGross = d(0), tDed = d(0), tNet = d(0), tEmp = d(0);
  const skipped: string[] = [];

  for (const e of employees) {
    const from = e.hireDate > start ? e.hireDate : start;
    const to = e.endDate && e.endDate < end ? e.endDate : end;
    const presentDays = workingDays(from, to);
    const leaves = await tx.leaveRequest.findMany({ where: { employeeId: e.id, status: "APPROVED", type: { paid: false }, startDate: { lte: to }, endDate: { gte: from } }, select: { startDate: true, endDate: true } });
    const unpaid = leaves.reduce((a, l) => a + workingDays(l.startDate > from ? l.startDate : from, l.endDate < to ? l.endDate : to), 0);
    const prorata = monthWorkdays > 0 ? d(Math.max(0, presentDays - unpaid)).div(monthWorkdays) : d(0);
    const extrasRows = await tx.employeePayrollItem.findMany({ where: { employeeId: e.id, isActive: true, startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] } });
    const extras: ExtraItem[] = extrasRows.map((x) => ({ name: x.name, type: x.type as "EARNING" | "DEDUCTION", category: x.category, amount: d(x.amount), taxable: x.taxable }));
    if (d(e.baseSalary).isZero() && extras.length === 0) { skipped.push(`${e.lastName} ${e.firstName}`); continue; }
    const calc = computePayslip({ baseSalary: d(e.baseSalary), prorata: prorata.toDecimalPlaces(6), items, extras, currency: run.currency });
    if (calc.net.lt(0)) throw businessRule(`Net négatif pour ${e.lastName} ${e.firstName} (${formatMoney(calc.net.toNumber(), run.currency)}) : vérifiez ses retenues.`);
    await tx.payslip.create({
      data: {
        companyId: ctx.company.id, runId, employeeId: e.id, baseSalary: e.baseSalary, prorata: prorata.toDecimalPlaces(6).toString(), unpaidDays: unpaid, gross: calc.gross.toString(), taxableGross: calc.taxableGross.toString(),
        totalDeductions: calc.deductions.toString(), netPay: calc.net.toString(), employerCharges: calc.employerCharges.toString(), employerCost: calc.employerCost.toString(), payoutMethod: e.payoutMethod, payoutReference: e.payoutReference,
        lines: { create: calc.lines.map((l, i) => ({ companyId: ctx.company.id, position: i, code: l.code, label: l.label, type: l.type, category: l.category, base: l.base?.toString() ?? null, rate: l.rate?.toString() ?? null, amount: l.amount.toString() })) },
      },
    });
    tGross = tGross.plus(calc.gross); tDed = tDed.plus(calc.deductions); tNet = tNet.plus(calc.net); tEmp = tEmp.plus(calc.employerCharges);
  }
  await tx.payrollRun.update({ where: { id: runId }, data: { totalGross: tGross.toString(), totalDeductions: tDed.toString(), totalNet: tNet.toString(), totalEmployer: tEmp.toString(), calculatedAt: new Date() } });
  return { skipped };
}

export async function createRun(ctx: Ctx, input: z.output<typeof runSchema>) {
  const { start } = monthBounds(input.year, input.month);
  if (start > day(new Date())) throw businessRule("On ne prépare pas la paie d'un mois qui n'a pas commencé.");
  if (await ctx.db.payrollRun.findFirst({ where: { year: input.year, month: input.month, status: { not: "CANCELLED" } } })) throw businessRule(`Une campagne existe déjà pour ${periodLabel(input.year, input.month)}.`);
  const res = await ctx.tx(async (tx) => {
    const run = await tx.payrollRun.create({ data: { companyId: ctx.company.id, year: input.year, month: input.month, currency: ctx.company.currency, notes: input.notes?.trim() || null, createdById: ctx.user.id } });
    const { skipped } = await calculate(tx, ctx, run.id);
    return { run, skipped };
  });
  await audit(ctx, { action: "payroll.run.create", resource: "PayrollRun", resourceId: res.run.id, summary: `${ctx.user.name} a préparé la paie de ${periodLabel(input.year, input.month)}.` });
  return res;
}

export async function recalculateRun(ctx: Ctx, id: string) {
  await assertRun(ctx, id);
  const res = await ctx.tx(async (tx) => { await lockRun(tx, id); return calculate(tx, ctx, id); });
  await audit(ctx, { action: "payroll.run.recalculate", resource: "PayrollRun", resourceId: id, summary: `${ctx.user.name} a recalculé la campagne de paie.` });
  return res;
}

/** Validation : numéros de bulletins attribués (sans trou), campagne figée, écriture comptable de paie générée si le module est actif. */
export async function validateRun(ctx: Ctx, id: string) {
  await assertRun(ctx, id);
  const run = await ctx.tx(async (tx) => {
    await lockRun(tx, id);
    const r = await tx.payrollRun.findFirstOrThrow({ where: { id } });
    if (r.status !== "DRAFT") throw businessRule("Cette campagne est déjà validée.");
    const { start } = monthBounds(r.year, r.month);
    if (start > day(new Date())) throw businessRule("On ne valide pas la paie d'un mois qui n'a pas commencé.");
    const slips = await tx.payslip.findMany({ where: { runId: id }, orderBy: { employee: { lastName: "asc" } } });
    if (slips.length === 0) throw businessRule("Aucun bulletin à valider : vérifiez les salariés et leurs salaires de base.");
    for (const s of slips) await tx.payslip.update({ where: { id: s.id }, data: { number: await nextNumber(tx, ctx.company.id, "payslip", new Date(Date.UTC(r.year, r.month - 1, 1))) } });
    const updated = await tx.payrollRun.update({ where: { id }, data: { status: "VALIDATED", validatedAt: new Date(), validatedById: ctx.user.id } });
    await emit(tx, ctx, "payroll.validated", { runId: id });
    return updated;
  });
  await audit(ctx, { action: "payroll.run.validate", resource: "PayrollRun", resourceId: id, summary: `${ctx.user.name} a validé la paie de ${periodLabel(run.year, run.month)} (net ${formatMoney(d(run.totalNet).toNumber(), run.currency)}).` });
  return run;
}

/**
 * Paiement des salaires : sortie de trésorerie du net total sur le compte choisi (solde contrôlé par Finance) et écriture comptable.
 * Si le module Finance n'est pas actif, la campagne est seulement marquée payée.
 */
export async function payRun(ctx: Ctx, input: z.output<typeof payRunSchema>) {
  const financeOn = ctx.hasModule("finance");
  if (financeOn && !input.accountId) throw businessRule("Choisissez le compte qui paie les salaires.");
  if (input.accountId && !(await ctx.db.financeAccount.findFirst({ where: { id: input.accountId, deletedAt: null, isActive: true }, select: { id: true } }))) throw notFound("Compte");
  await assertRun(ctx, input.id);
  const date = day(parseDate(input.date) ?? new Date());
  const run = await ctx.tx(async (tx) => {
    await lockRun(tx, input.id);
    const r = await tx.payrollRun.findFirstOrThrow({ where: { id: input.id } });
    if (r.status === "PAID") throw businessRule("Cette paie est déjà payée.");
    if (r.status !== "VALIDATED") throw businessRule("Validez la campagne avant de la payer.");
    const updated = await tx.payrollRun.update({ where: { id: input.id }, data: { status: "PAID", paidAt: date, paidById: ctx.user.id, accountId: input.accountId || null } });
    await emit(tx, ctx, "payroll.paid", { runId: input.id });
    return updated;
  });
  await audit(ctx, { action: "payroll.run.pay", resource: "PayrollRun", resourceId: run.id, summary: `${ctx.user.name} a payé les salaires de ${periodLabel(run.year, run.month)} (${formatMoney(d(run.totalNet).toNumber(), run.currency)}).` });
  return run;
}

/** Brouillon : supprimé. Validée non payée : annulée (écriture contre-passée). Payée : non annulable (régularisez par la paie suivante). */
export async function cancelRun(ctx: Ctx, id: string) {
  const r = await ctx.db.payrollRun.findFirst({ where: { id } });
  if (!r) throw notFound("Campagne de paie");
  if (r.status === "PAID") throw businessRule("Les salaires de cette campagne ont été payés : elle ne peut plus être annulée (régularisez sur la paie suivante).");
  if (r.status === "CANCELLED") throw businessRule("Cette campagne est déjà annulée.");
  await ctx.tx(async (tx) => {
    await lockRun(tx, id);
    if (r.status === "DRAFT") await tx.payrollRun.delete({ where: { id } });
    else { await tx.payrollRun.update({ where: { id }, data: { status: "CANCELLED" } }); await emit(tx, ctx, "payroll.cancelled", { runId: id }); }
  });
  await audit(ctx, { action: "payroll.run.cancel", resource: "PayrollRun", resourceId: id, summary: `${ctx.user.name} a ${r.status === "DRAFT" ? "supprimé le brouillon de" : "annulé"} la paie de ${periodLabel(r.year, r.month)}.` });
}

// ═══ Bulletins ════════════════════════════════════════════════

/** Un salarié ne voit que ses propres bulletins validés ; la paie voit tout. */
export async function listPayslips(ctx: Ctx, p: { employeeId?: string; skip: number; take: number }) {
  let employeeId = p.employeeId;
  if (!ctx.can("hr.payroll.manage")) {
    const me = await ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, select: { id: true } });
    if (!me) return { total: 0, rows: [] };
    employeeId = me.id;
  }
  const where = { run: { status: { in: ["VALIDATED", "PAID"] as ("VALIDATED" | "PAID")[] } }, ...(employeeId ? { employeeId } : {}) };
  const [total, rows] = await Promise.all([
    ctx.db.payslip.count({ where }),
    ctx.db.payslip.findMany({ where, orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }, { employee: { lastName: "asc" } }], skip: p.skip, take: p.take, include: { run: { select: { year: true, month: true, status: true } }, employee: { select: { id: true, firstName: true, lastName: true, number: true } } } }),
  ]);
  return { total, rows };
}

export async function getPayslip(ctx: Ctx, id: string) {
  const s = await ctx.db.payslip.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, run: true, employee: true } });
  if (!s) throw notFound("Bulletin");
  const manage = ctx.can("hr.payroll.manage");
  if (!manage) {
    if (!ctx.can("hr.payslip.read") || s.employee.userId !== ctx.user.id) throw notFound("Bulletin");
    if (s.run.status === "DRAFT" || s.run.status === "CANCELLED") throw notFound("Bulletin");
  }
  return s;
}
