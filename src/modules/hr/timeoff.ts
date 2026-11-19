import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { availableApprovers, cancelApprovals, requestApproval } from "@/core/approvals";
import type { Db } from "@/core/db/client";
import { businessRule, forbidden, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { loadCalendar } from "./calendar";
import { workingDays } from "./leave-calc";
import { assertNoConflict } from "./overlaps";
import { loadPolicy } from "./policy";
import type { timeOffSchema, timeOffTypeSchema, updateTimeOffSchema, updateTimeOffTypeSchema } from "./registers-schemas";
import { TIMEOFF_SCOPE, assertCan, assertInScope, employeeFilter, scopeOf } from "./scope";
import { dayOf, formatMinutes, hoursOf, intervalOf, parseDay, toMinutes, workMinutesBetween } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

// ═══ Types de permission ══════════════════════════════════════

export const listTimeOffTypes = (ctx: Ctx, includeInactive = false) => ctx.db.timeOffType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } });

const maxDaysOf = (v: unknown) => (v === "" || v == null ? null : Number(v));

export async function createTimeOffType(ctx: Ctx, input: z.output<typeof timeOffTypeSchema>) {
  assertCan(ctx, "hr.timeoff.manage");
  if (await ctx.db.timeOffType.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" } } })) throw businessRule("Ce type de permission existe déjà.");
  const t = await ctx.db.timeOffType.create({ data: { companyId: ctx.company.id, name: input.name.trim(), paid: input.paid, requiresProof: input.requiresProof, maxDays: maxDaysOf(input.maxDays) } });
  await audit(ctx, { action: "hr.timeoff_type.create", resource: "TimeOffType", resourceId: t.id, summary: `${ctx.user.name} a créé le type de permission « ${t.name} ».` });
  return t;
}

export async function updateTimeOffType(ctx: Ctx, input: z.output<typeof updateTimeOffTypeSchema>) {
  assertCan(ctx, "hr.timeoff.manage");
  const t = await ctx.db.timeOffType.findFirst({ where: { id: input.id } });
  if (!t) throw notFound("Type de permission");
  if (await ctx.db.timeOffType.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: input.id } } })) throw businessRule("Ce type de permission existe déjà.");
  const after = await ctx.db.timeOffType.update({ where: { id: input.id }, data: { name: input.name.trim(), paid: input.paid, requiresProof: input.requiresProof, maxDays: maxDaysOf(input.maxDays), isActive: input.isActive } });
  await audit(ctx, { action: "hr.timeoff_type.update", resource: "TimeOffType", resourceId: t.id, summary: `${ctx.user.name} a modifié le type de permission « ${after.name} ».`, before: { paid: t.paid, maxDays: t.maxDays, isActive: t.isActive }, after: { paid: after.paid, maxDays: after.maxDays, isActive: after.isActive } });
  return after;
}

// ═══ Calcul de la durée ═══════════════════════════════════════

export interface TimeOffPeriod { unit: "HOURLY" | "DAILY"; startDate: Date; startTime: string | null; endDate: Date; endTime: string | null; days: number; hours: number }

/** Durée d'une permission, calculée par le serveur : jours ouvrés (journalière) ou heures de travail effectives (horaire, y compris à cheval sur deux journées). */
export async function computePeriod(db: Pick<Db, "hrSettings" | "holiday">, input: { unit: "HOURLY" | "DAILY"; startDate: string; startTime?: string; endDate: string; endTime?: string }): Promise<TimeOffPeriod> {
  const start = parseDay(input.startDate), end = parseDay(input.endDate);
  if (!start || !end) throw businessRule("Date invalide.");
  if (end < start) throw businessRule("La fin de la permission précède son début.");
  const cal = await loadCalendar(db, start, end);
  if (input.unit === "DAILY") {
    const days = workingDays(start, end, cal);
    if (days <= 0) throw businessRule("La période ne comporte aucun jour travaillé (week-ends et jours fériés exclus).");
    return { unit: "DAILY", startDate: start, startTime: null, endDate: end, endTime: null, days, hours: 0 };
  }
  if (!input.startTime || !input.endTime) throw businessRule("Une permission horaire exige une heure de début et une heure de fin.");
  const a = intervalOf(start, input.startTime, end, input.endTime);
  if (a.end <= a.start) throw businessRule("L'heure de fin doit suivre l'heure de début.");
  const policy = await loadPolicy(db);
  const minutes = workMinutesBetween(start, input.startTime, end, input.endTime, policy.schedule, cal);
  if (minutes <= 0) throw businessRule(`La plage demandée ne couvre aucune heure de travail (horaire de référence ${policy.schedule.start}–${policy.schedule.end}, jours non travaillés exclus).`);
  return { unit: "HOURLY", startDate: start, startTime: input.startTime, endDate: end, endTime: input.endTime, days: 0, hours: hoursOf(minutes) };
}

const durationLabel = (p: Pick<TimeOffPeriod, "unit" | "days" | "hours">) => (p.unit === "DAILY" ? `${p.days} j` : formatMinutes(Math.round(p.hours * 60)));

// ═══ Lecture ══════════════════════════════════════════════════

export async function listTimeOffs(ctx: Ctx, p: { status?: string; employeeId?: string; typeId?: string; q?: string; skip: number; take: number }) {
  const scope = await scopeOf(ctx, TIMEOFF_SCOPE);
  if (scope.kind === "none") return { total: 0, rows: [], scope };
  const where = {
    ...employeeFilter(scope),
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.typeId ? { typeId: p.typeId } : {}),
    ...(p.employeeId && scope.kind === "all" ? { employeeId: p.employeeId } : {}),
    ...(p.q ? { OR: [{ employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }, { reason: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.timeOffRequest.count({ where }),
    ctx.db.timeOffRequest.findMany({ where, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, userId: true } }, type: { select: { id: true, name: true, requiresProof: true } } } }),
  ]);
  return { total, rows, scope };
}

export async function getTimeOff(ctx: Ctx, id: string) {
  const r = await ctx.db.timeOffRequest.findFirst({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, userId: true } }, type: true } });
  if (!r) throw notFound("Permission");
  assertInScope(await scopeOf(ctx, TIMEOFF_SCOPE), r.employeeId, "Permission");
  return r;
}

// ═══ Écriture ═════════════════════════════════════════════════

async function assertMayActFor(ctx: Ctx, employeeUserId: string | null) {
  const self = employeeUserId === ctx.user.id && ctx.can("hr.timeoff.request");
  if (!self && !ctx.can("hr.timeoff.manage")) throw forbidden("Vous ne pouvez demander une permission que pour vous-même (ou en tant que RH).");
}

async function checkType(ctx: Ctx, typeId: string, p: TimeOffPeriod) {
  const type = await ctx.db.timeOffType.findFirst({ where: { id: typeId, isActive: true } });
  if (!type) throw notFound("Type de permission");
  const cap = type.maxDays ? Number(type.maxDays) : null;
  if (cap != null) {
    const days = p.unit === "DAILY" ? p.days : Math.ceil((dayOf(p.endDate).getTime() - dayOf(p.startDate).getTime()) / 86_400_000) + 1;
    if (days > cap) throw businessRule(`« ${type.name} » est limité à ${cap} jour(s) par demande.`);
  }
  return type;
}

export async function createTimeOff(ctx: Ctx, input: z.output<typeof timeOffSchema>) {
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  await assertMayActFor(ctx, emp.userId);
  if (emp.status !== "ACTIVE") throw businessRule("Seul un salarié en activité peut demander une permission.");
  const period = await computePeriod(ctx.db, input);
  if (period.startDate < emp.hireDate) throw businessRule("La permission précède la date d'embauche.");
  const type = await checkType(ctx, input.typeId, period);
  await assertNoConflict(ctx.db, emp.id, period);
  const row = await ctx.db.timeOffRequest.create({
    data: {
      companyId: ctx.company.id, employeeId: emp.id, typeId: type.id, unit: period.unit, startDate: period.startDate, startTime: period.startTime, endDate: period.endDate, endTime: period.endTime,
      days: period.days, hours: period.hours, paid: input.paid ?? type.paid, reason: input.reason.trim(), comment: blank(input.comment), status: "DRAFT", createdById: ctx.user.id,
    },
  });
  await audit(ctx, { action: "hr.timeoff.create", resource: "TimeOffRequest", resourceId: row.id, summary: `${ctx.user.name} a enregistré une permission « ${type.name} » (${durationLabel(period)}) pour ${emp.firstName} ${emp.lastName} du ${fr(period.startDate)} au ${fr(period.endDate)}.` });
  return input.submit ? submitTimeOff(ctx, row.id) : { ...row, autoApproved: false };
}

/** Modification : uniquement un brouillon. Une permission en attente se retire (annulation) puis se refait ; une permission validée ne se modifie plus. */
export async function updateTimeOff(ctx: Ctx, input: z.output<typeof updateTimeOffSchema>) {
  const r = await getTimeOff(ctx, input.id);
  await assertMayActFor(ctx, r.employee.userId);
  if (r.status !== "DRAFT") throw businessRule(r.status === "APPROVED" ? "Cette permission est validée : annulez-la et refaites une demande pour la modifier." : r.status === "PENDING" ? "Cette permission est en cours de validation : annulez-la pour la modifier." : "Cette permission est clôturée.");
  const period = await computePeriod(ctx.db, input);
  const type = await checkType(ctx, input.typeId, period);
  await assertNoConflict(ctx.db, r.employeeId, period, { kind: "timeoff", id: r.id });
  const after = await ctx.db.timeOffRequest.update({
    where: { id: r.id },
    data: { typeId: type.id, unit: period.unit, startDate: period.startDate, startTime: period.startTime, endDate: period.endDate, endTime: period.endTime, days: period.days, hours: period.hours, paid: input.paid ?? type.paid, reason: input.reason.trim(), comment: blank(input.comment) },
  });
  await audit(ctx, { action: "hr.timeoff.update", resource: "TimeOffRequest", resourceId: r.id, summary: `${ctx.user.name} a modifié la permission de ${r.employee.firstName} ${r.employee.lastName} (${durationLabel(period)}).`, before: { startDate: r.startDate, endDate: r.endDate, hours: r.hours, days: r.days }, after: { startDate: after.startDate, endDate: after.endDate, hours: after.hours, days: after.days } });
  return after;
}

/**
 * Soumission à validation (moteur global « Validations »). Les chevauchements sont revérifiés (un congé a pu être posé entre-temps).
 * Sans autre approbateur possible (entreprise à administrateur unique), la permission est acceptée d'office et la décision est tracée.
 */
export async function submitTimeOff(ctx: Ctx, id: string) {
  const r = await getTimeOff(ctx, id);
  await assertMayActFor(ctx, r.employee.userId);
  if (r.status !== "DRAFT") throw businessRule("Seul un brouillon peut être soumis.");
  const type = await ctx.db.timeOffType.findFirst({ where: { id: r.typeId } });
  if (!type?.isActive) throw businessRule("Ce type de permission n'est plus disponible.");
  await assertNoConflict(ctx.db, r.employeeId, { startDate: r.startDate, startTime: r.startTime, endDate: r.endDate, endTime: r.endTime }, { kind: "timeoff", id: r.id });
  const amount = r.unit === "DAILY" ? Number(r.days) : Number(r.hours);
  const label = r.unit === "DAILY" ? `${Number(r.days)} j` : formatMinutes(Math.round(Number(r.hours) * 60));
  const title = `Permission ${r.employee.firstName} ${r.employee.lastName} du ${fr(r.startDate)}${r.startTime ? ` ${r.startTime}` : ""} au ${fr(r.endDate)}${r.endTime ? ` ${r.endTime}` : ""} (${label})`;
  const out = await ctx.tx(async (tx) => {
    const others = await availableApprovers(tx, ctx, "timeoff", amount);
    const auto = others.length === 0;
    const row = await tx.timeOffRequest.update({
      where: { id: r.id },
      data: auto ? { status: "APPROVED", submittedAt: new Date(), decidedById: ctx.user.id, decidedAt: new Date(), decisionComment: "Accepté d'office : aucun autre approbateur disponible" } : { status: "PENDING", submittedAt: new Date() },
    });
    if (!auto) await requestApproval(tx, ctx, { type: "timeoff", resourceId: r.id, title, amount, detail: `${ctx.user.name} demande une permission « ${type.name} » (${label}).` });
    return { row, auto };
  });
  await audit(ctx, { action: "hr.timeoff.submit", resource: "TimeOffRequest", resourceId: r.id, summary: `${ctx.user.name} a soumis la permission de ${r.employee.firstName} ${r.employee.lastName}${out.auto ? " — acceptée d'office : aucun autre approbateur disponible" : " à validation"}.` });
  return { ...out.row, autoApproved: out.auto };
}

/** Annulation : par le salarié ou un valideur/RH. Une permission validée dont la période est entamée ne s'annule plus (seule la RH le peut). */
export async function cancelTimeOff(ctx: Ctx, id: string) {
  const r = await getTimeOff(ctx, id);
  const own = r.employee.userId === ctx.user.id;
  if (!own && !ctx.can("hr.timeoff.approve") && !ctx.can("hr.timeoff.manage")) throw forbidden();
  if (r.status === "CANCELLED" || r.status === "REJECTED") throw businessRule("Cette permission est déjà clôturée.");
  if (r.status === "APPROVED" && r.startDate <= dayOf(new Date()) && !ctx.can("hr.timeoff.manage")) throw businessRule("Cette permission a déjà commencé : seule la RH peut l'annuler.");
  await ctx.tx(async (tx) => { await cancelApprovals(tx, "timeoff", id); await tx.timeOffRequest.update({ where: { id }, data: { status: "CANCELLED" } }); });
  await audit(ctx, { action: "hr.timeoff.cancel", resource: "TimeOffRequest", resourceId: id, summary: `${ctx.user.name} a annulé la permission de ${r.employee.firstName} ${r.employee.lastName} (${fr(r.startDate)} → ${fr(r.endDate)}).` });
}

/** Intégration présences : salariés bénéficiant d'une permission VALIDÉE ce jour-là (journée entière ou plage horaire). */
export async function timeOffOn(db: Pick<Db, "timeOffRequest">, date: Date) {
  const day = dayOf(date);
  const rows = await db.timeOffRequest.findMany({ where: { status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } }, select: { employeeId: true, unit: true, startDate: true, startTime: true, endDate: true, endTime: true } });
  const out = new Map<string, { full: boolean; from: string | null; to: string | null }>();
  for (const r of rows) {
    const from = r.startDate.getTime() === day.getTime() ? r.startTime : null;
    const to = r.endDate.getTime() === day.getTime() ? r.endTime : null;
    const full = r.unit === "DAILY" || (!from && !to) || (from != null && to != null && toMinutes(from) <= 0 && toMinutes(to) >= 1439);
    out.set(r.employeeId, { full, from, to });
  }
  return out;
}
