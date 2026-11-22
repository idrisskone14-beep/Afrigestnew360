import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { absentOn } from "./absences";
import { onLeaveOn } from "./leave";
import { loadPolicy } from "./policy";
import type { importLatenessSchema, justifyLatenessSchema, latenessSchema, updateLatenessSchema } from "./registers-schemas";
import { LATENESS_SCOPE, assertCan, assertInScope, employeeFilter, scopeOf } from "./scope";
import { timeOffOn } from "./timeoff";
import { addDays, dayOf, formatMinutes, lateMinutes, parseDay, toMinutes } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

/**
 * Le salarié était-il légitimement absent ou autorisé à arriver plus tard ? Congé, absence validée : pas de retard possible ce jour-là.
 * Une permission validée qui couvre toute la plage [heure prévue ; heure d'arrivée] exclut aussi le retard.
 */
async function assertNotCovered(ctx: Ctx, employeeId: string, date: Date, expected: string, actual: string) {
  const [leave, absent, offs] = await Promise.all([onLeaveOn(ctx.db, date), absentOn(ctx.db, date), timeOffOn(ctx.db, date)]);
  if (leave.has(employeeId)) throw businessRule("Le salarié est en congé ce jour-là : un retard ne peut pas être enregistré.");
  if (absent.has(employeeId)) throw businessRule("Le salarié est enregistré absent ce jour-là : un retard ne peut pas être enregistré.");
  const off = offs.get(employeeId);
  if (off && (off.full || (off.from && off.to && toMinutes(off.from) <= toMinutes(expected) && toMinutes(off.to) >= toMinutes(actual)))) {
    throw businessRule("Une permission validée couvre cette plage horaire : ce n'est pas un retard.");
  }
}

// ═══ Lecture ══════════════════════════════════════════════════

export async function listLateness(ctx: Ctx, p: { employeeId?: string; justification?: string; from?: Date; to?: Date; q?: string; skip: number; take: number }) {
  const scope = await scopeOf(ctx, LATENESS_SCOPE);
  if (scope.kind === "none") return { total: 0, rows: [], scope };
  const where = {
    ...employeeFilter(scope),
    ...(p.justification ? { justification: p.justification as never } : {}),
    ...(p.employeeId && scope.kind === "all" ? { employeeId: p.employeeId } : {}),
    ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
    ...(p.q ? { OR: [{ employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.latenessRecord.count({ where }),
    ctx.db.latenessRecord.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } } } }),
  ]);
  return { total, rows, scope };
}

/** Historique individuel. */
export async function latenessHistory(ctx: Ctx, employeeId: string, take = 60) {
  assertInScope(await scopeOf(ctx, LATENESS_SCOPE), employeeId, "Salarié");
  return ctx.db.latenessRecord.findMany({ where: { employeeId }, orderBy: { date: "desc" }, take });
}

/** Statistiques d'un mois : total, minutes cumulées, retards non justifiés, répartition par salarié. */
export async function latenessStats(ctx: Ctx, year: number, month: number) {
  const scope = await scopeOf(ctx, LATENESS_SCOPE);
  if (scope.kind === "none") return { year, month, count: 0, minutes: 0, unjustified: 0, employees: 0, perEmployee: [] as { employeeId: string; name: string; number: string; count: number; minutes: number }[], perDay: [] as { day: number; count: number }[] };
  const from = new Date(Date.UTC(year, month - 1, 1)), to = new Date(Date.UTC(year, month, 0));
  const rows = await ctx.db.latenessRecord.findMany({ where: { ...employeeFilter(scope), date: { gte: from, lte: to } }, select: { employeeId: true, date: true, minutesLate: true, justification: true, employee: { select: { firstName: true, lastName: true, number: true } } } });
  const per = new Map<string, { employeeId: string; name: string; number: string; count: number; minutes: number }>();
  const perDay = Array.from({ length: to.getUTCDate() }, (_, i) => ({ day: i + 1, count: 0 }));
  let minutes = 0, unjustified = 0;
  for (const r of rows) {
    minutes += r.minutesLate;
    if (r.justification !== "ACCEPTED") unjustified++;
    perDay[r.date.getUTCDate() - 1]!.count++;
    const e = per.get(r.employeeId) ?? { employeeId: r.employeeId, name: `${r.employee.lastName} ${r.employee.firstName}`, number: r.employee.number, count: 0, minutes: 0 };
    e.count++; e.minutes += r.minutesLate;
    per.set(r.employeeId, e);
  }
  return { year, month, count: rows.length, minutes, unjustified, employees: per.size, perEmployee: [...per.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes), perDay };
}

/**
 * Retards récurrents : au moins N retards non justifiés sur les P derniers jours (seuils paramétrables).
 * Signal destiné à la RH : aucune sanction ni retenue n'en découle automatiquement.
 */
export async function recurringLateness(ctx: Ctx, today = new Date()) {
  const scope = await scopeOf(ctx, LATENESS_SCOPE);
  if (scope.kind === "none") return [];
  const policy = await loadPolicy(ctx.db);
  const since = addDays(dayOf(today), -(policy.lateRecurrenceDays - 1));
  const rows = await ctx.db.latenessRecord.findMany({
    where: { ...employeeFilter(scope), date: { gte: since, lte: dayOf(today) }, justification: { not: "ACCEPTED" } },
    select: { employeeId: true, minutesLate: true, employee: { select: { firstName: true, lastName: true, number: true } } },
  });
  const by = new Map<string, { employeeId: string; name: string; number: string; count: number; minutes: number }>();
  for (const r of rows) {
    const e = by.get(r.employeeId) ?? { employeeId: r.employeeId, name: `${r.employee.lastName} ${r.employee.firstName}`, number: r.employee.number, count: 0, minutes: 0 };
    e.count++; e.minutes += r.minutesLate;
    by.set(r.employeeId, e);
  }
  return [...by.values()].filter((e) => e.count >= policy.lateRecurrenceCount).sort((a, b) => b.count - a.count);
}

// ═══ Écriture ═════════════════════════════════════════════════

export async function createLateness(ctx: Ctx, input: z.output<typeof latenessSchema>) {
  assertCan(ctx, "hr.lateness.manage");
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  const date = parseDay(input.date);
  if (!date) throw businessRule("Date invalide.");
  if (date > dayOf(new Date())) throw businessRule("Un retard ne peut pas être enregistré à une date future.");
  if (date < emp.hireDate) throw businessRule("La date précède l'embauche du salarié.");
  const policy = await loadPolicy(ctx.db);
  const expected = input.expectedTime || policy.schedule.start;
  const minutes = lateMinutes(expected, input.actualTime, policy.lateGraceMinutes);
  if (minutes <= 0) throw businessRule(`Aucun retard : l'arrivée à ${input.actualTime} ne dépasse pas l'heure prévue (${expected})${policy.lateGraceMinutes ? ` + ${policy.lateGraceMinutes} min de tolérance` : ""}.`);
  if (await ctx.db.latenessRecord.findFirst({ where: { employeeId: emp.id, date }, select: { id: true } })) throw businessRule("Un retard est déjà enregistré pour ce salarié à cette date.");
  await assertNotCovered(ctx, emp.id, date, expected, input.actualTime);
  const row = await ctx.db.latenessRecord.create({ data: { companyId: ctx.company.id, employeeId: emp.id, date, expectedTime: expected, actualTime: input.actualTime, minutesLate: minutes, reason: blank(input.reason), source: "MANUAL", createdById: ctx.user.id } });
  await audit(ctx, { action: "hr.lateness.create", resource: "LatenessRecord", resourceId: row.id, summary: `${ctx.user.name} a enregistré un retard de ${formatMinutes(minutes)} pour ${emp.firstName} ${emp.lastName} le ${fr(date)}.` });
  return row;
}

export async function updateLateness(ctx: Ctx, input: z.output<typeof updateLatenessSchema>) {
  assertCan(ctx, "hr.lateness.manage");
  const r = await ctx.db.latenessRecord.findFirst({ where: { id: input.id }, include: { employee: { select: { firstName: true, lastName: true } } } });
  if (!r) throw notFound("Retard");
  assertInScope(await scopeOf(ctx, LATENESS_SCOPE), r.employeeId, "Retard");
  const policy = await loadPolicy(ctx.db);
  const expected = input.expectedTime || r.expectedTime;
  const minutes = lateMinutes(expected, input.actualTime, policy.lateGraceMinutes);
  if (minutes <= 0) throw businessRule("Avec ces heures, il n'y a pas de retard : supprimez l'enregistrement s'il est erroné.");
  const after = await ctx.db.latenessRecord.update({ where: { id: r.id }, data: { expectedTime: expected, actualTime: input.actualTime, minutesLate: minutes, reason: blank(input.reason) } });
  await audit(ctx, { action: "hr.lateness.update", resource: "LatenessRecord", resourceId: r.id, summary: `${ctx.user.name} a corrigé le retard de ${r.employee.firstName} ${r.employee.lastName} du ${fr(r.date)} (${r.minutesLate} → ${minutes} min).`, before: { actualTime: r.actualTime, minutesLate: r.minutesLate }, after: { actualTime: after.actualTime, minutesLate: after.minutesLate } });
  return after;
}

export async function justifyLateness(ctx: Ctx, input: z.output<typeof justifyLatenessSchema>) {
  assertCan(ctx, "hr.lateness.manage");
  const r = await ctx.db.latenessRecord.findFirst({ where: { id: input.id }, include: { employee: { select: { firstName: true, lastName: true } } } });
  if (!r) throw notFound("Retard");
  const after = await ctx.db.latenessRecord.update({ where: { id: r.id }, data: { justification: input.justification, hrNote: blank(input.hrNote) } });
  await audit(ctx, { action: "hr.lateness.justify", resource: "LatenessRecord", resourceId: r.id, summary: `${ctx.user.name} a passé le retard de ${r.employee.firstName} ${r.employee.lastName} du ${fr(r.date)} à « ${input.justification} ».`, before: { justification: r.justification }, after: { justification: after.justification } });
  return after;
}

export async function deleteLateness(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.lateness.manage");
  const r = await ctx.db.latenessRecord.findFirst({ where: { id }, include: { employee: { select: { firstName: true, lastName: true } } } });
  if (!r) throw notFound("Retard");
  await ctx.db.latenessRecord.delete({ where: { id } });
  await audit(ctx, { action: "hr.lateness.delete", resource: "LatenessRecord", resourceId: id, summary: `${ctx.user.name} a supprimé le retard de ${r.employee.firstName} ${r.employee.lastName} du ${fr(r.date)} (${r.minutesLate} min).`, before: { date: r.date, minutesLate: r.minutesLate, justification: r.justification } });
}

/**
 * Intégration Présences : crée les retards des pointages dont l'heure d'arrivée dépasse l'horaire de référence (+ tolérance).
 * Idempotent (un retard déjà enregistré n'est jamais écrasé) ; les jours de congé, d'absence ou de permission couvrante sont ignorés.
 */
export async function importLatenessFromAttendance(ctx: Ctx, input: z.output<typeof importLatenessSchema>) {
  assertCan(ctx, "hr.lateness.manage");
  const from = parseDay(input.from), to = parseDay(input.to);
  if (!from || !to) throw businessRule("Période invalide.");
  if (to < from) throw businessRule("La fin de période précède son début.");
  if ((to.getTime() - from.getTime()) / 86_400_000 > 92) throw businessRule("Importez au plus 3 mois à la fois.");
  if (to > dayOf(new Date())) throw businessRule("La période ne peut pas dépasser aujourd'hui.");
  const policy = await loadPolicy(ctx.db);
  const attendances = await ctx.db.attendance.findMany({ where: { date: { gte: from, lte: to }, checkIn: { not: null }, status: { in: ["PRESENT", "LATE", "REMOTE", "HALF_DAY"] }, employee: { deletedAt: null } }, select: { employeeId: true, date: true, checkIn: true } });
  const existing = new Set((await ctx.db.latenessRecord.findMany({ where: { date: { gte: from, lte: to } }, select: { employeeId: true, date: true } })).map((r) => `${r.employeeId}|${r.date.toISOString().slice(0, 10)}`));
  let created = 0, already = 0, skipped = 0;
  for (const a of attendances) {
    const minutes = lateMinutes(policy.schedule.start, a.checkIn!, policy.lateGraceMinutes);
    if (minutes <= 0) continue;
    if (existing.has(`${a.employeeId}|${a.date.toISOString().slice(0, 10)}`)) { already++; continue; }
    try { await assertNotCovered(ctx, a.employeeId, a.date, policy.schedule.start, a.checkIn!); } catch { skipped++; continue; }
    await ctx.db.latenessRecord.create({ data: { companyId: ctx.company.id, employeeId: a.employeeId, date: a.date, expectedTime: policy.schedule.start, actualTime: a.checkIn!, minutesLate: minutes, source: "ATTENDANCE", createdById: ctx.user.id } });
    created++;
  }
  await audit(ctx, { action: "hr.lateness.import", resource: "LatenessRecord", summary: `${ctx.user.name} a importé les retards des présences du ${fr(from)} au ${fr(to)} : ${created} créé(s), ${already} déjà enregistré(s), ${skipped} ignoré(s) (congé, absence ou permission).` });
  return { created, already, skipped };
}
