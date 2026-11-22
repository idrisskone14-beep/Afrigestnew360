import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { availableApprovers, cancelApprovals, requestApproval } from "@/core/approvals";
import type { Db } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { loadCalendar } from "./calendar";
import { workingDays } from "./leave-calc";
import { assertNoConflict } from "./overlaps";
import { sickOn } from "./sickleave";
import { loadPolicy } from "./policy";
import type { absenceSchema, absenceTypeSchema, justifyAbsenceSchema, updateAbsenceSchema, updateAbsenceTypeSchema } from "./registers-schemas";
import { ABSENCE_SCOPE, assertCan, assertInScope, employeeFilter, scopeOf } from "./scope";
import { addDays, dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

// ═══ Types d'absence (motifs configurables) ═══════════════════

export const listAbsenceTypes = (ctx: Ctx, includeInactive = false) => ctx.db.absenceType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });

export async function createAbsenceType(ctx: Ctx, input: z.input<typeof absenceTypeSchema>) {
  assertCan(ctx, "hr.absence.manage");
  if (input.deductFromPay === true) assertCan(ctx, "hr.payroll.manage", "Seule la paie peut marquer un motif comme retenu sur salaire.");
  if (await ctx.db.absenceType.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" } } })) throw businessRule("Ce motif d'absence existe déjà.");
  const t = await ctx.db.absenceType.create({ data: { companyId: ctx.company.id, name: input.name.trim(), category: input.category, requiresValidation: input.requiresValidation ?? false, requiresProof: input.requiresProof ?? false, deductFromPay: input.deductFromPay === true } });
  await audit(ctx, { action: "hr.absence_type.create", resource: "AbsenceType", resourceId: t.id, summary: `${ctx.user.name} a créé le motif d'absence « ${t.name} ».` });
  return t;
}

export async function updateAbsenceType(ctx: Ctx, input: z.output<typeof updateAbsenceTypeSchema>) {
  assertCan(ctx, "hr.absence.manage");
  const t = await ctx.db.absenceType.findFirst({ where: { id: input.id } });
  if (!t) throw notFound("Motif d'absence");
  if (input.deductFromPay !== t.deductFromPay) assertCan(ctx, "hr.payroll.manage", "Seule la paie peut modifier la retenue sur salaire d'un motif.");
  if (await ctx.db.absenceType.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: input.id } } })) throw businessRule("Ce motif d'absence existe déjà.");
  const after = await ctx.db.absenceType.update({ where: { id: input.id }, data: { name: input.name.trim(), category: input.category, requiresValidation: input.requiresValidation, requiresProof: input.requiresProof, deductFromPay: input.deductFromPay, isActive: input.isActive } });
  await audit(ctx, { action: "hr.absence_type.update", resource: "AbsenceType", resourceId: t.id, summary: `${ctx.user.name} a modifié le motif d'absence « ${after.name} ».`, before: { category: t.category, requiresValidation: t.requiresValidation, isActive: t.isActive }, after: { category: after.category, requiresValidation: after.requiresValidation, isActive: after.isActive } });
  return after;
}

// ═══ Lecture ══════════════════════════════════════════════════

export async function listAbsences(ctx: Ctx, p: { status?: string; employeeId?: string; typeId?: string; category?: string; justification?: string; q?: string; skip: number; take: number }) {
  const scope = await scopeOf(ctx, ABSENCE_SCOPE);
  if (scope.kind === "none") return { total: 0, rows: [], scope };
  const where = {
    ...employeeFilter(scope),
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.typeId ? { typeId: p.typeId } : {}),
    ...(p.category ? { type: { category: p.category as never } } : {}),
    ...(p.justification ? { justification: p.justification as never } : {}),
    ...(p.employeeId && scope.kind === "all" ? { employeeId: p.employeeId } : {}),
    ...(p.q ? { OR: [{ employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }, { reason: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.absenceRecord.count({ where }),
    ctx.db.absenceRecord.findMany({ where, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } }, type: { select: { id: true, name: true, category: true, requiresProof: true, requiresValidation: true } } } }),
  ]);
  return { total, rows, scope };
}

export async function getAbsence(ctx: Ctx, id: string) {
  const r = await ctx.db.absenceRecord.findFirst({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } }, type: true } });
  if (!r) throw notFound("Absence");
  assertInScope(await scopeOf(ctx, ABSENCE_SCOPE), r.employeeId, "Absence");
  return r;
}

/** Historique d'un salarié (RH ou responsable dans sa portée). */
export async function absenceHistory(ctx: Ctx, employeeId: string, take = 50) {
  assertInScope(await scopeOf(ctx, ABSENCE_SCOPE), employeeId, "Salarié");
  return ctx.db.absenceRecord.findMany({ where: { employeeId }, orderBy: { startDate: "desc" }, take, include: { type: { select: { name: true, category: true } } } });
}

/**
 * Absences répétées : salariés ayant au moins N absences injustifiées (motif « injustifiée » ou justificatif refusé), validées, sur les P derniers jours
 * (seuils paramétrables). Signal destiné à la RH : AUCUNE sanction ni retenue n'en découle automatiquement.
 */
export async function repeatedAbsences(ctx: Ctx, today = new Date()) {
  const scope = await scopeOf(ctx, ABSENCE_SCOPE);
  if (scope.kind === "none") return [];
  const policy = await loadPolicy(ctx.db);
  const since = addDays(dayOf(today), -(policy.absenceRepeatDays - 1));
  const rows = await ctx.db.absenceRecord.findMany({
    where: { ...employeeFilter(scope), status: "APPROVED", startDate: { gte: since, lte: dayOf(today) }, OR: [{ type: { category: "UNJUSTIFIED" } }, { justification: "REFUSED" }] },
    select: { employeeId: true, days: true, employee: { select: { firstName: true, lastName: true, number: true } } },
  });
  const by = new Map<string, { employeeId: string; name: string; number: string; occurrences: number; days: number }>();
  for (const r of rows) {
    const e = by.get(r.employeeId) ?? { employeeId: r.employeeId, name: `${r.employee.lastName} ${r.employee.firstName}`, number: r.employee.number, occurrences: 0, days: 0 };
    e.occurrences++; e.days += Number(r.days);
    by.set(r.employeeId, e);
  }
  return [...by.values()].filter((e) => e.occurrences >= policy.absenceRepeatCount).sort((a, b) => b.occurrences - a.occurrences);
}

// ═══ Écriture ═════════════════════════════════════════════════

async function computeDays(db: Pick<Db, "hrSettings" | "holiday">, input: { startDate: string; endDate: string; halfDay: boolean }) {
  const start = parseDay(input.startDate), end = parseDay(input.endDate);
  if (!start || !end) throw businessRule("Date invalide.");
  if (end < start) throw businessRule("La fin de l'absence précède son début.");
  if (input.halfDay && start.getTime() !== end.getTime()) throw businessRule("Une demi-journée porte sur une seule date.");
  const cal = await loadCalendar(db, start, end);
  const wd = workingDays(start, end, cal);
  if (wd <= 0) throw businessRule("La période ne comporte aucun jour travaillé (week-ends et jours fériés exclus).");
  return { start, end, days: input.halfDay ? 0.5 : wd };
}

const defaultJustification = (t: { requiresProof: boolean; category: string }) => (t.requiresProof ? ("PENDING" as const) : t.category === "UNJUSTIFIED" ? ("REFUSED" as const) : ("NOT_REQUIRED" as const));

export async function createAbsence(ctx: Ctx, input: z.output<typeof absenceSchema>) {
  assertCan(ctx, "hr.absence.manage");
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  const type = await ctx.db.absenceType.findFirst({ where: { id: input.typeId, isActive: true } });
  if (!type) throw notFound("Motif d'absence");
  const { start, end, days } = await computeDays(ctx.db, input);
  if (start < emp.hireDate) throw businessRule("L'absence précède la date d'embauche.");
  if (emp.endDate && end > emp.endDate) throw businessRule("L'absence dépasse la date de sortie du salarié.");
  await assertNoConflict(ctx.db, emp.id, { startDate: start, startTime: null, endDate: end, endTime: null });
  const title = `Absence ${emp.firstName} ${emp.lastName} du ${fr(start)} au ${fr(end)} (${days} j)`;
  const out = await ctx.tx(async (tx) => {
    let status: "APPROVED" | "PENDING" = "APPROVED";
    let auto = false;
    if (type.requiresValidation) {
      auto = (await availableApprovers(tx, ctx, "absence", days)).length === 0;
      status = auto ? "APPROVED" : "PENDING";
    }
    const row = await tx.absenceRecord.create({
      data: {
        companyId: ctx.company.id, employeeId: emp.id, typeId: type.id, startDate: start, endDate: end, halfDay: input.halfDay, days, reason: blank(input.reason), justification: defaultJustification(type), status, createdById: ctx.user.id,
        ...(type.requiresValidation && auto ? { decidedById: ctx.user.id, decidedAt: new Date(), decisionComment: "Accepté d'office : aucun autre approbateur disponible" } : {}),
      },
    });
    if (status === "PENDING") await requestApproval(tx, ctx, { type: "absence", resourceId: row.id, title, amount: days, detail: `${ctx.user.name} déclare une absence « ${type.name} » (${days} j) pour ${emp.firstName} ${emp.lastName}.` });
    return row;
  });
  await audit(ctx, { action: "hr.absence.create", resource: "AbsenceRecord", resourceId: out.id, summary: `${ctx.user.name} a enregistré une absence « ${type.name} » de ${days} j pour ${emp.firstName} ${emp.lastName} (${fr(start)} → ${fr(end)})${out.status === "PENDING" ? " — en attente de validation" : ""}.` });
  return out;
}

/** Modification : refusée pendant la validation et après une décision pour les motifs soumis à validation ; sinon libre et tracée. */
export async function updateAbsence(ctx: Ctx, input: z.output<typeof updateAbsenceSchema>) {
  assertCan(ctx, "hr.absence.manage");
  const r = await getAbsence(ctx, input.id);
  if (r.status === "CANCELLED" || r.status === "REJECTED") throw businessRule("Cette absence est clôturée.");
  if (r.type.requiresValidation) throw businessRule(r.status === "PENDING" ? "Cette absence est en cours de validation : annulez-la pour la modifier." : "Cette absence a été validée : annulez-la et enregistrez-la à nouveau pour la modifier.");
  const type = await ctx.db.absenceType.findFirst({ where: { id: input.typeId, isActive: true } });
  if (!type) throw notFound("Motif d'absence");
  if (type.requiresValidation) throw businessRule("Ce motif exige une validation : créez une nouvelle absence avec ce motif.");
  const { start, end, days } = await computeDays(ctx.db, input);
  await assertNoConflict(ctx.db, r.employeeId, { startDate: start, startTime: null, endDate: end, endTime: null }, { kind: "absence", id: r.id });
  const after = await ctx.db.absenceRecord.update({ where: { id: r.id }, data: { typeId: type.id, startDate: start, endDate: end, halfDay: input.halfDay, days, reason: blank(input.reason) } });
  await audit(ctx, { action: "hr.absence.update", resource: "AbsenceRecord", resourceId: r.id, summary: `${ctx.user.name} a modifié l'absence de ${r.employee.firstName} ${r.employee.lastName}.`, before: { startDate: r.startDate, endDate: r.endDate, days: r.days, type: r.type.name }, after: { startDate: after.startDate, endDate: after.endDate, days: after.days, type: type.name } });
  return after;
}

export async function justifyAbsence(ctx: Ctx, input: z.output<typeof justifyAbsenceSchema>) {
  assertCan(ctx, "hr.absence.manage");
  const r = await getAbsence(ctx, input.id);
  const after = await ctx.db.absenceRecord.update({ where: { id: r.id }, data: { justification: input.justification, hrNote: blank(input.hrNote) } });
  await audit(ctx, { action: "hr.absence.justify", resource: "AbsenceRecord", resourceId: r.id, summary: `${ctx.user.name} a passé le justificatif de l'absence de ${r.employee.firstName} ${r.employee.lastName} à « ${input.justification} ».`, before: { justification: r.justification }, after: { justification: after.justification } });
  return after;
}

export async function cancelAbsence(ctx: Ctx, id: string) {
  const r = await getAbsence(ctx, id);
  if (!ctx.can("hr.absence.manage") && !ctx.can("hr.absence.approve")) throw businessRule("Vous n'avez pas le droit d'annuler cette absence.");
  if (r.status === "CANCELLED" || r.status === "REJECTED") throw businessRule("Cette absence est déjà clôturée.");
  await ctx.tx(async (tx) => { await cancelApprovals(tx, "absence", id); await tx.absenceRecord.update({ where: { id }, data: { status: "CANCELLED" } }); });
  await audit(ctx, { action: "hr.absence.cancel", resource: "AbsenceRecord", resourceId: id, summary: `${ctx.user.name} a annulé l'absence de ${r.employee.firstName} ${r.employee.lastName} (${fr(r.startDate)} → ${fr(r.endDate)}).` });
}

/** Intégration présences : salariés absents ce jour-là (absences VALIDÉES ou saisies sans validation). */
export async function absentOn(db: Pick<Db, "absenceRecord" | "sickLeave">, date: Date) {
  const day = dayOf(date);
  const rows = await db.absenceRecord.findMany({ where: { status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } }, select: { employeeId: true, halfDay: true, type: { select: { name: true } } } });
  const out = new Map(rows.map((r) => [r.employeeId, { label: r.type.name, halfDay: r.halfDay }]));
  // arrêts maladie : lus dans leur registre (rien n'est dupliqué dans les absences)
  for (const id of await sickOn(db, date)) out.set(id, { label: "Arrêt maladie", halfDay: false });
  return out;
}
