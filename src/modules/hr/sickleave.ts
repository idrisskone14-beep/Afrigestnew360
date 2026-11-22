import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { loadCalendar } from "./calendar";
import { workingDays } from "./leave-calc";
import { assertNoConflict } from "./overlaps";
import { loadPolicy } from "./policy";
import type { extendSickLeaveSchema, returnSickLeaveSchema, sickLeaveSchema, updateSickLeaveSchema } from "./registers-schemas";
import { assertCan } from "./scope";
import { addDays, dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const KEY = "hr.sickleave.read";

/**
 * Arrêts maladie : suivi ADMINISTRATIF uniquement (dates, justificatif reçu ou non, reprise). Aucune donnée médicale (diagnostic, pathologie)
 * n'est collectée ; le certificat lui-même se joint dans la GED, en accès restreint aux profils « arrêts maladie ».
 */

/** Dernier jour d'absence : la veille de la reprise effective si elle est connue, sinon la fin prévue. */
export const sickEffectiveEnd = (s: { expectedEndDate: Date; returnDate: Date | null }) => (s.returnDate ? addDays(s.returnDate, -1) : s.expectedEndDate);

/** Durée en jours calendaires (début et fin inclus). */
export const sickCalendarDays = (s: { startDate: Date; expectedEndDate: Date; returnDate: Date | null }) => Math.round((sickEffectiveEnd(s).getTime() - s.startDate.getTime()) / 86_400_000) + 1;

export interface SickAlert { code: "return_due" | "overdue" | "certificate"; message: string }

/** Alertes d'un arrêt (fonction pure) : reprise proche, fin dépassée sans reprise enregistrée, justificatif manquant. */
export function sickAlerts(s: { status: string; expectedEndDate: Date; returnDate: Date | null; certificate: string }, today: Date, alertDays: number): SickAlert[] {
  if (s.status !== "ONGOING") return [];
  const out: SickAlert[] = [];
  const t = dayOf(today).getTime();
  const left = Math.round((s.expectedEndDate.getTime() - t) / 86_400_000);
  if (left < 0) out.push({ code: "overdue", message: `Fin prévue dépassée de ${-left} j : enregistrez la reprise ou prolongez l'arrêt` });
  else if (left <= alertDays) out.push({ code: "return_due", message: left === 0 ? "Fin prévue aujourd'hui : reprise à confirmer" : `Fin prévue dans ${left} j : reprise à préparer` });
  if (s.certificate === "PENDING" || s.certificate === "REFUSED") out.push({ code: "certificate", message: s.certificate === "PENDING" ? "Justificatif médical attendu" : "Justificatif non conforme" });
  return out;
}

export async function listSickLeaves(ctx: Ctx, p: { status?: string; employeeId?: string; q?: string; skip: number; take: number }) {
  assertCan(ctx, KEY);
  const where = {
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.q ? { OR: [{ employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows, policy] = await Promise.all([
    ctx.db.sickLeave.count({ where }),
    ctx.db.sickLeave.findMany({ where, orderBy: [{ startDate: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } }, _count: { select: { extensions: true } } } }),
    loadPolicy(ctx.db),
  ]);
  const today = new Date();
  return { total, rows: rows.map((r) => ({ ...r, days: sickCalendarDays(r), alerts: sickAlerts(r, today, policy.sickReturnAlertDays) })) };
}

export async function getSickLeave(ctx: Ctx, id: string) {
  assertCan(ctx, KEY);
  const r = await ctx.db.sickLeave.findFirst({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } }, extensions: { orderBy: { createdAt: "asc" } } } });
  if (!r) throw notFound("Arrêt maladie");
  return r;
}

/** Historique des arrêts d'un salarié (réservé aux profils « arrêts maladie »). */
export async function sickLeaveHistory(ctx: Ctx, employeeId: string) {
  assertCan(ctx, KEY);
  return ctx.db.sickLeave.findMany({ where: { employeeId }, orderBy: { startDate: "desc" }, take: 50 });
}

/** Arrêts à surveiller : reprise proche ou fin dépassée (tableau de bord et alertes). */
export async function sickLeaveAlerts(ctx: Ctx, today = new Date()) {
  assertCan(ctx, KEY);
  const [rows, policy] = await Promise.all([
    ctx.db.sickLeave.findMany({ where: { status: "ONGOING" }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } } }, orderBy: { expectedEndDate: "asc" } }),
    loadPolicy(ctx.db),
  ]);
  return rows.map((r) => ({ ...r, alerts: sickAlerts(r, today, policy.sickReturnAlertDays) })).filter((r) => r.alerts.some((a) => a.code !== "certificate"));
}

async function period(db: Pick<Db, "hrSettings" | "holiday">, startRaw: string, endRaw: string, hire: Date) {
  const start = parseDay(startRaw), end = parseDay(endRaw);
  if (!start || !end) throw businessRule("Date invalide.");
  if (end < start) throw businessRule("La fin prévue précède le début de l'arrêt.");
  if (start < hire) throw businessRule("L'arrêt précède la date d'embauche.");
  const cal = await loadCalendar(db, start, end);
  return { start, end, workDays: workingDays(start, end, cal) };
}

export async function createSickLeave(ctx: Ctx, input: z.output<typeof sickLeaveSchema>) {
  assertCan(ctx, "hr.sickleave.manage");
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  if (emp.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs.");
  const { start, end } = await period(ctx.db, input.startDate, input.expectedEndDate, emp.hireDate);
  await assertNoConflict(ctx.db, emp.id, { startDate: start, startTime: null, endDate: end, endTime: null });
  const row = await ctx.db.sickLeave.create({ data: { companyId: ctx.company.id, employeeId: emp.id, startDate: start, expectedEndDate: end, certificate: input.certificate, observations: blank(input.observations), createdById: ctx.user.id } });
  await audit(ctx, { action: "hr.sickleave.create", resource: "SickLeave", resourceId: row.id, summary: `${ctx.user.name} a enregistré un arrêt maladie pour ${emp.firstName} ${emp.lastName} du ${fr(start)} au ${fr(end)}.` });
  return row;
}

async function loadOngoing(ctx: Ctx, id: string) {
  const r = await getSickLeave(ctx, id);
  if (r.status !== "ONGOING") throw businessRule(r.status === "ENDED" ? "Cet arrêt est terminé (reprise enregistrée)." : "Cet arrêt est annulé.");
  return r;
}

/** Correction administrative (dates initiales, justificatif, observations) d'un arrêt en cours. Pour allonger un arrêt, utilisez la prolongation (historisée). */
export async function updateSickLeave(ctx: Ctx, input: z.output<typeof updateSickLeaveSchema>) {
  assertCan(ctx, "hr.sickleave.manage");
  const r = await loadOngoing(ctx, input.id);
  const hire = (await ctx.db.employee.findFirst({ where: { id: r.employeeId }, select: { hireDate: true } }))!.hireDate;
  const { start, end } = await period(ctx.db, input.startDate, input.expectedEndDate, hire);
  if (r.extensions.length > 0 && end < r.expectedEndDate) throw businessRule("Cet arrêt a été prolongé : sa fin prévue ne peut pas être raccourcie ici (enregistrez la reprise).");
  await assertNoConflict(ctx.db, r.employeeId, { startDate: start, startTime: null, endDate: end, endTime: null }, { kind: "sickleave", id: r.id });
  const after = await ctx.db.sickLeave.update({ where: { id: r.id }, data: { startDate: start, expectedEndDate: end, certificate: input.certificate, observations: blank(input.observations) } });
  await audit(ctx, { action: "hr.sickleave.update", resource: "SickLeave", resourceId: r.id, summary: `${ctx.user.name} a modifié l'arrêt maladie de ${r.employee.firstName} ${r.employee.lastName}.`, before: { startDate: r.startDate, expectedEndDate: r.expectedEndDate, certificate: r.certificate }, after: { startDate: after.startDate, expectedEndDate: after.expectedEndDate, certificate: after.certificate } });
  return after;
}

/** Prolongation : la nouvelle fin doit dépasser la fin actuelle ; l'ancienne fin et la nouvelle sont conservées dans l'historique. */
export async function extendSickLeave(ctx: Ctx, input: z.output<typeof extendSickLeaveSchema>) {
  assertCan(ctx, "hr.sickleave.manage");
  const r = await loadOngoing(ctx, input.id);
  const newEnd = parseDay(input.newEnd);
  if (!newEnd) throw businessRule("Date invalide.");
  if (newEnd <= r.expectedEndDate) throw businessRule(`La nouvelle fin doit dépasser la fin actuelle (${fr(r.expectedEndDate)}).`);
  await assertNoConflict(ctx.db, r.employeeId, { startDate: r.startDate, startTime: null, endDate: newEnd, endTime: null }, { kind: "sickleave", id: r.id });
  await ctx.tx(async (tx) => {
    await tx.sickLeaveExtension.create({ data: { companyId: ctx.company.id, sickLeaveId: r.id, previousEnd: r.expectedEndDate, newEnd, note: blank(input.note), createdById: ctx.user.id } });
    await tx.sickLeave.update({ where: { id: r.id }, data: { expectedEndDate: newEnd } });
  });
  await audit(ctx, { action: "hr.sickleave.extend", resource: "SickLeave", resourceId: r.id, summary: `${ctx.user.name} a prolongé l'arrêt maladie de ${r.employee.firstName} ${r.employee.lastName} : fin prévue ${fr(r.expectedEndDate)} → ${fr(newEnd)}.` });
}

/**
 * Reprise effective : premier jour de travail après l'arrêt. Elle peut précéder la fin prévue (reprise anticipée) ou la suivre (les jours en plus
 * restent comptés en absence). Elle clôt l'arrêt ; les absences et présences se lisent à partir de ces dates.
 */
export async function recordReturn(ctx: Ctx, input: z.output<typeof returnSickLeaveSchema>) {
  assertCan(ctx, "hr.sickleave.manage");
  const r = await loadOngoing(ctx, input.id);
  const ret = parseDay(input.returnDate);
  if (!ret) throw businessRule("Date invalide.");
  if (ret <= r.startDate) throw businessRule("La reprise doit suivre le premier jour d'arrêt.");
  if (ret > addDays(dayOf(new Date()), 1)) throw businessRule("La reprise ne peut pas être enregistrée plus d'un jour à l'avance.");
  const lastDay = addDays(ret, -1);
  if (lastDay > r.expectedEndDate) await assertNoConflict(ctx.db, r.employeeId, { startDate: addDays(r.expectedEndDate, 1), startTime: null, endDate: lastDay, endTime: null }, { kind: "sickleave", id: r.id });
  await ctx.db.sickLeave.update({ where: { id: r.id }, data: { returnDate: ret, status: "ENDED" } });
  await audit(ctx, { action: "hr.sickleave.return", resource: "SickLeave", resourceId: r.id, summary: `${ctx.user.name} a enregistré la reprise de ${r.employee.firstName} ${r.employee.lastName} au ${fr(ret)} (fin prévue : ${fr(r.expectedEndDate)}).` });
}

export async function cancelSickLeave(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.sickleave.manage");
  const r = await getSickLeave(ctx, id);
  if (r.status === "CANCELLED") throw businessRule("Cet arrêt est déjà annulé.");
  await ctx.db.sickLeave.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(ctx, { action: "hr.sickleave.cancel", resource: "SickLeave", resourceId: id, summary: `${ctx.user.name} a annulé l'arrêt maladie de ${r.employee.firstName} ${r.employee.lastName} (${fr(r.startDate)} → ${fr(r.expectedEndDate)}).` });
}

/** Intégration présences / absences : salariés en arrêt maladie (en cours ou terminé) ce jour-là. */
export async function sickOn(db: Pick<Db, "sickLeave">, date: Date) {
  const day = dayOf(date);
  const rows = await db.sickLeave.findMany({ where: { status: { in: ["ONGOING", "ENDED"] }, startDate: { lte: day } }, select: { employeeId: true, expectedEndDate: true, returnDate: true } });
  return new Set(rows.filter((r) => sickEffectiveEnd(r) >= day).map((r) => r.employeeId));
}
