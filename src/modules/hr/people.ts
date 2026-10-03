import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, notFound } from "@/core/errors";
import { roundMoney } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import { onLeaveOn } from "./leave";
import type { attendanceSchema, bulkAttendanceSchema, evaluationSchema, trainingSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
const iso = (v: Date) => v.toISOString().slice(0, 10);

// ═══ Présences ════════════════════════════════════════════════

async function activeEmployee(ctx: Ctx, id: string) {
  const e = await ctx.db.employee.findFirst({ where: { id, deletedAt: null } });
  if (!e) throw notFound("Salarié");
  if (e.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs.");
  return e;
}

function assertPastOrToday(date: Date) {
  if (date > day(new Date())) throw businessRule("Les présences ne se saisissent pas à l'avance.");
}

export async function setAttendance(ctx: Ctx, input: z.output<typeof attendanceSchema>) {
  const emp = await activeEmployee(ctx, input.employeeId);
  const date = day(parseDate(input.date)!);
  assertPastOrToday(date);
  if (date < emp.hireDate) throw businessRule("Cette date précède l'embauche du salarié.");
  if (input.checkIn && input.checkOut && input.checkOut <= input.checkIn) throw businessRule("L'heure de départ doit suivre l'heure d'arrivée.");
  if ((await onLeaveOn(ctx.db, date)).has(emp.id)) throw businessRule("Ce salarié est en congé approuvé ce jour-là.");
  const data = { status: input.status, checkIn: blank(input.checkIn), checkOut: blank(input.checkOut), notes: blank(input.notes) };
  const a = await ctx.db.attendance.upsert({
    where: { employeeId_date: { employeeId: emp.id, date } },
    create: { companyId: ctx.company.id, employeeId: emp.id, date, createdById: ctx.user.id, ...data },
    update: data,
  });
  await audit(ctx, { action: "hr.attendance.set", resource: "Attendance", resourceId: a.id, summary: `${ctx.user.name} a pointé ${emp.firstName} ${emp.lastName} « ${input.status} » le ${iso(date)}.` });
  return a;
}

/** Marque « présent » tous les salariés en activité sans pointage ni congé ce jour (jour ouvré uniquement). */
export async function markAllPresent(ctx: Ctx, input: z.output<typeof bulkAttendanceSchema>) {
  const date = day(parseDate(input.date)!);
  assertPastOrToday(date);
  const w = date.getUTCDay();
  if (w === 0 || w === 6) throw businessRule("Ce jour n'est pas ouvré (week-end).");
  const [emps, done, leave] = await Promise.all([
    ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null, hireDate: { lte: date } }, select: { id: true } }),
    ctx.db.attendance.findMany({ where: { date }, select: { employeeId: true } }),
    onLeaveOn(ctx.db, date),
  ]);
  const skip = new Set([...done.map((x) => x.employeeId), ...leave]);
  const todo = emps.filter((e) => !skip.has(e.id));
  if (todo.length) await ctx.db.attendance.createMany({ data: todo.map((e) => ({ companyId: ctx.company.id, employeeId: e.id, date, status: "PRESENT" as const, createdById: ctx.user.id })) });
  await audit(ctx, { action: "hr.attendance.bulk", resource: "Attendance", summary: `${ctx.user.name} a marqué ${todo.length} salarié(s) présent(s) le ${iso(date)}.` });
  return { marked: todo.length };
}

export interface BoardRow { employeeId: string; number: string; name: string; jobTitle: string | null; status: string | null; checkIn: string | null; checkOut: string | null; notes: string | null; onLeave: boolean }

/** Feuille de présence d'un jour : chaque salarié en activité avec son pointage ou son congé approuvé. */
export async function attendanceBoard(ctx: Ctx, dateInput: Date): Promise<BoardRow[]> {
  const date = day(dateInput);
  const [emps, records, leave] = await Promise.all([
    ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null, hireDate: { lte: date } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    ctx.db.attendance.findMany({ where: { date } }),
    onLeaveOn(ctx.db, date),
  ]);
  const byEmp = new Map(records.map((r) => [r.employeeId, r]));
  return emps.map((e) => { const r = byEmp.get(e.id); return { employeeId: e.id, number: e.number, name: `${e.lastName} ${e.firstName}`, jobTitle: e.jobTitle, status: r?.status ?? null, checkIn: r?.checkIn ?? null, checkOut: r?.checkOut ?? null, notes: r?.notes ?? null, onLeave: leave.has(e.id) }; });
}

/** Récapitulatif mensuel des pointages par salarié. */
export async function attendanceMonth(ctx: Ctx, year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1)), to = new Date(Date.UTC(year, month, 0));
  const [emps, groups] = await Promise.all([
    ctx.db.employee.findMany({ where: { deletedAt: null, hireDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, number: true, firstName: true, lastName: true } }),
    ctx.db.attendance.groupBy({ by: ["employeeId", "status"], where: { date: { gte: from, lte: to } }, _count: true }),
  ]);
  return emps.map((e) => {
    const count = (s: string) => groups.find((g) => g.employeeId === e.id && g.status === s)?._count ?? 0;
    return { employeeId: e.id, number: e.number, name: `${e.lastName} ${e.firstName}`, present: count("PRESENT"), remote: count("REMOTE"), late: count("LATE"), half: count("HALF_DAY"), absent: count("ABSENT") };
  });
}

// ═══ Évaluations et formations ════════════════════════════════

export async function createEvaluation(ctx: Ctx, input: z.output<typeof evaluationSchema>) {
  const emp = await activeEmployee(ctx, input.employeeId);
  const ev = await ctx.db.evaluation.create({ data: { companyId: ctx.company.id, employeeId: emp.id, period: input.period.trim(), date: day(parseDate(input.date)!), score: input.score, objectives: blank(input.objectives), comments: blank(input.comments), evaluatorId: ctx.user.id } });
  await audit(ctx, { action: "hr.evaluation.create", resource: "Evaluation", resourceId: ev.id, summary: `${ctx.user.name} a évalué ${emp.firstName} ${emp.lastName} (${ev.period}) : ${ev.score}/5.` });
  return ev;
}

export async function deleteEvaluation(ctx: Ctx, id: string) {
  const ev = await ctx.db.evaluation.findFirst({ where: { id }, include: { employee: { select: { firstName: true, lastName: true } } } });
  if (!ev) throw notFound("Évaluation");
  await ctx.db.evaluation.delete({ where: { id } });
  await audit(ctx, { action: "hr.evaluation.delete", resource: "Evaluation", resourceId: id, summary: `${ctx.user.name} a supprimé l'évaluation ${ev.period} de ${ev.employee.firstName} ${ev.employee.lastName}.` });
}

export async function createTraining(ctx: Ctx, input: z.output<typeof trainingSchema>) {
  const emp = await activeEmployee(ctx, input.employeeId);
  const t = await ctx.db.training.create({ data: { companyId: ctx.company.id, employeeId: emp.id, title: input.title.trim(), provider: blank(input.provider), date: day(parseDate(input.date)!), hours: input.hours, cost: roundMoney(input.cost, ctx.company.currency).toString(), notes: blank(input.notes) } });
  await audit(ctx, { action: "hr.training.create", resource: "Training", resourceId: t.id, summary: `${ctx.user.name} a enregistré la formation « ${t.title} » pour ${emp.firstName} ${emp.lastName}.` });
  return t;
}

export async function deleteTraining(ctx: Ctx, id: string) {
  const t = await ctx.db.training.findFirst({ where: { id } });
  if (!t) throw notFound("Formation");
  await ctx.db.training.delete({ where: { id } });
  await audit(ctx, { action: "hr.training.delete", resource: "Training", resourceId: id, summary: `${ctx.user.name} a supprimé la formation « ${t.title} ».` });
}

/** Valeurs par défaut RH d'une entreprise : types de congé usuels (à adapter au droit du travail local). */
export async function ensureHrDefaults(tx: Db, companyId: string) {
  if ((await tx.leaveType.count({ where: { companyId } })) > 0) return;
  await tx.leaveType.createMany({
    data: [
      { companyId, name: "Congé annuel", annualDays: 22, paid: true },
      { companyId, name: "Maladie", annualDays: 0, paid: true },
      { companyId, name: "Maternité / paternité", annualDays: 0, paid: true },
      { companyId, name: "Événement familial", annualDays: 10, paid: true },
      { companyId, name: "Sans solde", annualDays: 0, paid: false },
    ],
  });
}
