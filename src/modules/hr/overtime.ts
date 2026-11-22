import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { availableApprovers, cancelApprovals, requestApproval } from "@/core/approvals";
import type { Db } from "@/core/db/client";
import { businessRule, forbidden, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { loadCalendar } from "./calendar";
import { assertNoConflict } from "./overlaps";
import { loadPolicy } from "./policy";
import type { overtimeRateSchema, overtimeSchema, updateOvertimeRateSchema, updateOvertimeSchema } from "./admin-schemas";
import { OVERTIME_SCOPE, assertCan, assertInScope, employeeFilter, scopeOf } from "./scope";
import { dayOf, formatMinutes, hoursOf, intervalOf, overlaps, parseDay, toMinutes, workMinutesBetween } from "./time";

type Ctx = TenantContext;
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

// ═══ Taux de majoration (paramétrables) ═══════════════════════

export const listOvertimeRates = (ctx: Ctx, includeInactive = false) => ctx.db.overtimeRate.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { multiplier: "asc" } });

export async function createOvertimeRate(ctx: Ctx, input: z.output<typeof overtimeRateSchema>) {
  assertCan(ctx, "hr.overtime.manage");
  if (await ctx.db.overtimeRate.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" } } })) throw businessRule("Ce taux existe déjà.");
  const r = await ctx.db.overtimeRate.create({ data: { companyId: ctx.company.id, name: input.name.trim(), multiplier: input.multiplier, description: input.description?.trim() || null } });
  await audit(ctx, { action: "hr.overtime_rate.create", resource: "OvertimeRate", resourceId: r.id, summary: `${ctx.user.name} a créé le taux de majoration « ${r.name} » (× ${input.multiplier}).` });
  return r;
}

export async function updateOvertimeRate(ctx: Ctx, input: z.output<typeof updateOvertimeRateSchema>) {
  assertCan(ctx, "hr.overtime.manage");
  const r = await ctx.db.overtimeRate.findFirst({ where: { id: input.id } });
  if (!r) throw notFound("Taux de majoration");
  if (await ctx.db.overtimeRate.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: input.id } } })) throw businessRule("Ce taux existe déjà.");
  const after = await ctx.db.overtimeRate.update({ where: { id: input.id }, data: { name: input.name.trim(), multiplier: input.multiplier, description: input.description?.trim() || null, isActive: input.isActive } });
  await audit(ctx, { action: "hr.overtime_rate.update", resource: "OvertimeRate", resourceId: r.id, summary: `${ctx.user.name} a modifié le taux « ${after.name} » (× ${String(r.multiplier)} → × ${String(after.multiplier)}).`, before: { multiplier: r.multiplier, isActive: r.isActive }, after: { multiplier: after.multiplier, isActive: after.isActive } });
  return after;
}

// ═══ Calcul ═══════════════════════════════════════════════════

/**
 * Durée d'une période d'heures supplémentaires : heures réalisées, et heures normales prévues ce jour-là (horaire de référence).
 * Une plage qui empiète sur l'horaire normal d'un jour travaillé n'est pas une heure supplémentaire : elle est refusée.
 */
export async function computeOvertime(db: Pick<Db, "hrSettings" | "holiday">, input: { date: string; startTime: string; endTime: string }) {
  const date = parseDay(input.date);
  if (!date) throw businessRule("Date invalide.");
  if (date > dayOf(new Date())) throw businessRule("Des heures supplémentaires ne peuvent pas être déclarées à l'avance.");
  const a = toMinutes(input.startTime), b = toMinutes(input.endTime);
  if (b <= a) throw businessRule("L'heure de fin doit suivre l'heure de début (même journée).");
  const policy = await loadPolicy(db);
  const cal = await loadCalendar(db, date, date);
  const inNormal = workMinutesBetween(date, input.startTime, date, input.endTime, policy.schedule, cal);
  if (inNormal > 0) throw businessRule(`Cette plage empiète de ${formatMinutes(inNormal)} sur l'horaire normal (${policy.schedule.start}–${policy.schedule.end}) : seules les heures hors horaire normal sont supplémentaires.`);
  const normal = workMinutesBetween(date, policy.schedule.start, date, policy.schedule.end, policy.schedule, cal);
  return { date, normalHours: hoursOf(normal), hours: hoursOf(b - a) };
}

// ═══ Lecture ══════════════════════════════════════════════════

export async function listOvertime(ctx: Ctx, p: { status?: string; employeeId?: string; q?: string; from?: Date; to?: Date; skip: number; take: number }) {
  const scope = await scopeOf(ctx, OVERTIME_SCOPE);
  if (scope.kind === "none") return { total: 0, rows: [], scope };
  const where = {
    ...employeeFilter(scope),
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.employeeId && scope.kind === "all" ? { employeeId: p.employeeId } : {}),
    ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
    ...(p.q ? { OR: [{ employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }, { reason: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.overtimeRecord.count({ where }),
    ctx.db.overtimeRecord.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, userId: true } }, rate: { select: { name: true, multiplier: true } } } }),
  ]);
  return { total, rows, scope };
}

export async function getOvertime(ctx: Ctx, id: string) {
  const r = await ctx.db.overtimeRecord.findFirst({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, userId: true } }, rate: true } });
  if (!r) throw notFound("Heures supplémentaires");
  assertInScope(await scopeOf(ctx, OVERTIME_SCOPE), r.employeeId, "Heures supplémentaires");
  return r;
}

// ═══ Écriture ═════════════════════════════════════════════════

function assertMayActFor(ctx: Ctx, employeeUserId: string | null) {
  const self = employeeUserId === ctx.user.id && ctx.can("hr.overtime.request");
  if (!self && !ctx.can("hr.overtime.manage")) throw forbidden("Vous ne pouvez déclarer des heures supplémentaires que pour vous-même (ou en tant que RH).");
}

async function assertFree(ctx: Ctx, employeeId: string, date: Date, startTime: string, endTime: string, ignoreId?: string) {
  await assertNoConflict(ctx.db, employeeId, { startDate: date, startTime, endDate: date, endTime });
  const same = await ctx.db.overtimeRecord.findMany({ where: { employeeId, date, status: { in: ["PENDING", "APPROVED"] }, ...(ignoreId ? { id: { not: ignoreId } } : {}) }, select: { startTime: true, endTime: true } });
  const me = intervalOf(date, startTime, date, endTime);
  if (same.some((o) => overlaps(me, intervalOf(date, o.startTime, date, o.endTime)))) throw businessRule("Chevauche d'autres heures supplémentaires déjà déclarées ce jour-là.");
}

async function checkRate(ctx: Ctx, rateId?: string) {
  if (!rateId) return null;
  const r = await ctx.db.overtimeRate.findFirst({ where: { id: rateId, isActive: true } });
  if (!r) throw notFound("Taux de majoration");
  return r.id;
}

export async function createOvertime(ctx: Ctx, input: z.output<typeof overtimeSchema>) {
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  assertMayActFor(ctx, emp.userId);
  if (emp.status !== "ACTIVE") throw businessRule("Seul un salarié en activité peut effectuer des heures supplémentaires.");
  const c = await computeOvertime(ctx.db, input);
  if (c.date < emp.hireDate) throw businessRule("La date précède l'embauche.");
  await assertFree(ctx, emp.id, c.date, input.startTime, input.endTime);
  const rateId = ctx.can("hr.overtime.manage") ? await checkRate(ctx, input.rateId || undefined) : null;
  const row = await ctx.db.overtimeRecord.create({ data: { companyId: ctx.company.id, employeeId: emp.id, date: c.date, startTime: input.startTime, endTime: input.endTime, normalHours: c.normalHours, hours: c.hours, rateId, reason: input.reason.trim(), status: "DRAFT", createdById: ctx.user.id } });
  await audit(ctx, { action: "hr.overtime.create", resource: "OvertimeRecord", resourceId: row.id, summary: `${ctx.user.name} a enregistré ${c.hours} h supplémentaires pour ${emp.firstName} ${emp.lastName} le ${fr(c.date)}.` });
  return input.submit ? submitOvertime(ctx, row.id) : { ...row, autoApproved: false };
}

export async function updateOvertime(ctx: Ctx, input: z.output<typeof updateOvertimeSchema>) {
  const r = await getOvertime(ctx, input.id);
  assertMayActFor(ctx, r.employee.userId);
  if (r.status !== "DRAFT") throw businessRule(r.status === "APPROVED" ? "Ces heures sont validées : annulez-les et refaites une déclaration pour les modifier." : r.status === "PENDING" ? "Ces heures sont en cours de validation : annulez-les pour les modifier." : "Cette déclaration est clôturée.");
  const c = await computeOvertime(ctx.db, input);
  await assertFree(ctx, r.employeeId, c.date, input.startTime, input.endTime, r.id);
  const rateId = ctx.can("hr.overtime.manage") ? await checkRate(ctx, input.rateId || undefined) : r.rateId;
  return ctx.db.overtimeRecord.update({ where: { id: r.id }, data: { date: c.date, startTime: input.startTime, endTime: input.endTime, normalHours: c.normalHours, hours: c.hours, rateId, reason: input.reason.trim() } });
}

/** Soumission au moteur de validation (hiérarchique). Sans autre approbateur, acceptée d'office et tracée. */
export async function submitOvertime(ctx: Ctx, id: string) {
  const r = await getOvertime(ctx, id);
  assertMayActFor(ctx, r.employee.userId);
  if (r.status !== "DRAFT") throw businessRule("Seul un brouillon peut être soumis.");
  await assertFree(ctx, r.employeeId, r.date, r.startTime, r.endTime, r.id);
  const hours = Number(r.hours);
  const title = `Heures supplémentaires ${r.employee.firstName} ${r.employee.lastName} le ${fr(r.date)} (${r.startTime}–${r.endTime}, ${hours} h)`;
  const out = await ctx.tx(async (tx) => {
    const auto = (await availableApprovers(tx, ctx, "overtime", hours)).length === 0;
    const row = await tx.overtimeRecord.update({
      where: { id: r.id },
      data: auto ? { status: "APPROVED", approvedHours: r.hours, submittedAt: new Date(), decidedById: ctx.user.id, decidedAt: new Date(), decisionComment: "Accepté d'office : aucun autre approbateur disponible" } : { status: "PENDING", submittedAt: new Date() },
    });
    if (!auto) await requestApproval(tx, ctx, { type: "overtime", resourceId: r.id, title, amount: hours, detail: `${ctx.user.name} soumet ${hours} h supplémentaires (${fr(r.date)}).` });
    return { row, auto };
  });
  await audit(ctx, { action: "hr.overtime.submit", resource: "OvertimeRecord", resourceId: r.id, summary: `${ctx.user.name} a soumis les heures supplémentaires de ${r.employee.firstName} ${r.employee.lastName}${out.auto ? " — acceptées d'office : aucun autre approbateur disponible" : " à validation"}.` });
  return { ...out.row, autoApproved: out.auto };
}

export async function cancelOvertime(ctx: Ctx, id: string) {
  const r = await getOvertime(ctx, id);
  const own = r.employee.userId === ctx.user.id;
  if (!own && !ctx.can("hr.overtime.approve") && !ctx.can("hr.overtime.manage")) throw forbidden();
  if (r.status === "CANCELLED" || r.status === "REJECTED") throw businessRule("Cette déclaration est déjà clôturée.");
  if (r.status === "APPROVED" && !ctx.can("hr.overtime.manage")) throw businessRule("Ces heures sont validées : seule la RH peut les annuler.");
  await ctx.tx(async (tx) => { await cancelApprovals(tx, "overtime", id); await tx.overtimeRecord.update({ where: { id }, data: { status: "CANCELLED", approvedHours: null } }); });
  await audit(ctx, { action: "hr.overtime.cancel", resource: "OvertimeRecord", resourceId: id, summary: `${ctx.user.name} a annulé les heures supplémentaires de ${r.employee.firstName} ${r.employee.lastName} du ${fr(r.date)}.` });
}

/** La RH affecte (ou change) le taux de majoration d'une déclaration en attente ou validée ; le changement est tracé. */
export async function assignOvertimeRate(ctx: Ctx, input: { id: string; rateId: string }) {
  assertCan(ctx, "hr.overtime.manage");
  const r = await getOvertime(ctx, input.id);
  if (r.status !== "PENDING" && r.status !== "APPROVED" && r.status !== "DRAFT") throw businessRule("Cette déclaration est clôturée.");
  const rateId = await checkRate(ctx, input.rateId);
  const after = await ctx.db.overtimeRecord.update({ where: { id: r.id }, data: { rateId }, include: { rate: true } });
  await audit(ctx, { action: "hr.overtime.rate", resource: "OvertimeRecord", resourceId: r.id, summary: `${ctx.user.name} a affecté le taux « ${after.rate?.name ?? "—"} » aux heures supplémentaires de ${r.employee.firstName} ${r.employee.lastName} du ${fr(r.date)}.`, before: { rateId: r.rateId }, after: { rateId } });
}
