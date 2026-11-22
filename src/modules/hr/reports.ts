import "server-only";
import { businessRule } from "@/core/errors";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { loadCalendar } from "./calendar";
import { workingDays } from "./leave-calc";
import { assertCan } from "./scope";
import { sickEffectiveEnd } from "./sickleave";

type Ctx = TenantContext;
const DAY = 86_400_000;

/** Ligne du rapport mensuel : une colonne n'est remplie que si l'utilisateur a le droit de voir le registre correspondant (sinon `null`). */
export interface MonthlyRow {
  employeeId: string; number: string; name: string; department: string | null;
  leaveDays: number | null; timeOffDays: number | null; timeOffHours: number | null; absenceDays: number | null; unjustifiedDays: number | null; sickDays: number | null;
  lateCount: number | null; lateMinutes: number | null; overtimeHours: number | null; accidents: number | null;
}

const clip = (s: Date, e: Date, from: Date, to: Date) => ({ s: s > from ? s : from, e: e < to ? e : to });

/**
 * Rapport RH consolidé d'un mois, une ligne par salarié : congés, permissions, absences, arrêts maladie, retards, heures supplémentaires approuvées, accidents.
 * Réservé aux profils qui voient tous les salariés (`hr.employee.read`) ; chaque colonne exige en plus le droit du registre concerné.
 * Les jours sont des jours ouvrés (calendrier de l'entreprise) ; les arrêts maladie, des jours calendaires.
 */
export async function monthlyReport(ctx: Ctx, year: number, month: number): Promise<{ year: number; month: number; rows: MonthlyRow[]; totals: Omit<MonthlyRow, "employeeId" | "number" | "name" | "department"> }> {
  assertCan(ctx, "hr.employee.read");
  if (!(month >= 1 && month <= 12 && year >= 2000 && year <= 2100)) throw businessRule("Période invalide.");
  const from = new Date(Date.UTC(year, month - 1, 1)), to = new Date(Date.UTC(year, month, 0));
  const can = { leave: ctx.can("hr.leave.read") || ctx.can("hr.leave.approve"), off: ctx.can("hr.timeoff.read") || ctx.can("hr.timeoff.manage"), abs: ctx.can("hr.absence.read") || ctx.can("hr.absence.manage"), sick: ctx.can("hr.sickleave.read"), late: ctx.can("hr.lateness.read") || ctx.can("hr.lateness.manage"), ot: ctx.can("hr.overtime.read") || ctx.can("hr.overtime.manage"), acc: ctx.can("hr.accident.read") };
  const cal = await loadCalendar(ctx.db, from, to);
  const emps = await ctx.db.employee.findMany({ where: { deletedAt: null, hireDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, number: true, firstName: true, lastName: true, department: { select: { name: true } } } });
  const ids = emps.map((e) => e.id);
  const overlap = { startDate: { lte: to }, endDate: { gte: from } };
  const [leaves, offs, abs, sicks, lates, ots, accs] = await Promise.all([
    can.leave ? ctx.db.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", ...overlap }, select: { employeeId: true, startDate: true, endDate: true } }) : [],
    can.off ? ctx.db.timeOffRequest.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", ...overlap }, select: { employeeId: true, unit: true, startDate: true, endDate: true, hours: true } }) : [],
    can.abs ? ctx.db.absenceRecord.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", ...overlap }, select: { employeeId: true, startDate: true, endDate: true, halfDay: true, justification: true, type: { select: { category: true } } } }) : [],
    can.sick ? ctx.db.sickLeave.findMany({ where: { employeeId: { in: ids }, status: { in: ["ONGOING", "ENDED"] }, startDate: { lte: to } }, select: { employeeId: true, startDate: true, expectedEndDate: true, returnDate: true } }) : [],
    can.late ? ctx.db.latenessRecord.findMany({ where: { employeeId: { in: ids }, date: { gte: from, lte: to } }, select: { employeeId: true, minutesLate: true } }) : [],
    can.ot ? ctx.db.overtimeRecord.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", date: { gte: from, lte: to } }, select: { employeeId: true, approvedHours: true } }) : [],
    can.acc ? ctx.db.workAccident.findMany({ where: { employeeId: { in: ids }, occurredOn: { gte: from, lte: to } }, select: { employeeId: true } }) : [],
  ]);
  const by = <T extends { employeeId: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]); return m; };
  const L = by(leaves), O = by(offs), A = by(abs), S = by(sicks), T = by(lates), V = by(ots), C = by(accs);
  const rows: MonthlyRow[] = emps.map((e) => {
    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
    const r: MonthlyRow = {
      employeeId: e.id, number: e.number, name: `${e.lastName} ${e.firstName}`, department: e.department?.name ?? null,
      leaveDays: can.leave ? sum((L.get(e.id) ?? []).map((l) => { const c = clip(l.startDate, l.endDate, from, to); return workingDays(c.s, c.e, cal); })) : null,
      timeOffDays: can.off ? sum((O.get(e.id) ?? []).filter((o) => o.unit === "DAILY").map((o) => { const c = clip(o.startDate, o.endDate, from, to); return workingDays(c.s, c.e, cal); })) : null,
      timeOffHours: can.off ? sum((O.get(e.id) ?? []).filter((o) => o.unit === "HOURLY").map((o) => Number(o.hours))) : null,
      absenceDays: can.abs ? sum((A.get(e.id) ?? []).map((a) => (a.halfDay ? 0.5 : (() => { const c = clip(a.startDate, a.endDate, from, to); return workingDays(c.s, c.e, cal); })()))) : null,
      unjustifiedDays: can.abs ? sum((A.get(e.id) ?? []).filter((a) => a.type.category === "UNJUSTIFIED" || a.justification === "REFUSED").map((a) => (a.halfDay ? 0.5 : (() => { const c = clip(a.startDate, a.endDate, from, to); return workingDays(c.s, c.e, cal); })()))) : null,
      sickDays: can.sick ? sum((S.get(e.id) ?? []).map((s) => { const end = sickEffectiveEnd(s); if (end < from) return 0; const c = clip(s.startDate, end, from, to); return c.e < c.s ? 0 : Math.round((c.e.getTime() - c.s.getTime()) / DAY) + 1; })) : null,
      lateCount: can.late ? (T.get(e.id) ?? []).length : null,
      lateMinutes: can.late ? (T.get(e.id) ?? []).reduce((a, t) => a + t.minutesLate, 0) : null,
      overtimeHours: can.ot ? sum((V.get(e.id) ?? []).map((v) => Number(v.approvedHours ?? 0))) : null,
      accidents: can.acc ? (C.get(e.id) ?? []).length : null,
    };
    return r;
  });
  const tot = (k: keyof MonthlyRow) => (rows.some((r) => r[k] === null) ? null : Math.round(rows.reduce((a, r) => a + Number(r[k] ?? 0), 0) * 100) / 100);
  return { year, month, rows, totals: { leaveDays: tot("leaveDays"), timeOffDays: tot("timeOffDays"), timeOffHours: tot("timeOffHours"), absenceDays: tot("absenceDays"), unjustifiedDays: tot("unjustifiedDays"), sickDays: tot("sickDays"), lateCount: tot("lateCount"), lateMinutes: tot("lateMinutes"), overtimeHours: tot("overtimeHours"), accidents: tot("accidents") } };
}

/** Soldes de congés de tous les salariés pour une année (rapport consolidé) : droit, report, acquis, pris, en attente, reste, par type plafonné. */
export async function leaveBalanceReport(ctx: Ctx, year: number) {
  assertCan(ctx, "hr.employee.read");
  if (!(ctx.can("hr.leave.read") || ctx.can("hr.leave.approve"))) assertCan(ctx, "hr.leave.read");
  const { leaveBalances } = await import("./leave");
  const emps = await ctx.db.employee.findMany({ where: { deletedAt: null, hireDate: { lte: new Date(Date.UTC(year, 11, 31)) }, OR: [{ endDate: null }, { endDate: { gte: new Date(Date.UTC(year, 0, 1)) } }] }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, number: true, firstName: true, lastName: true } });
  const out: { employeeId: string; number: string; name: string; type: string; entitlement: number; carryOver: number; taken: number; pending: number; remaining: number }[] = [];
  for (const e of emps) {
    for (const b of await leaveBalances(ctx, e.id, year, new Date(Date.UTC(year, 11, 31)))) {
      if (!b.capped) continue;
      out.push({ employeeId: e.id, number: e.number, name: `${e.lastName} ${e.firstName}`, type: b.type.name, entitlement: num(b.entitlement), carryOver: b.carryOver, taken: num(b.taken), pending: num(b.pending), remaining: num(b.remaining) });
    }
  }
  return out;
}

/** Historique des droits d'un salarié : une ligne par année et par type plafonné (droit de l'année, report reçu, pris, en attente, reste). */
export async function leaveEntitlementHistory(ctx: Ctx, employeeId: string, years = 4) {
  const { leaveBalances } = await import("./leave");
  const thisYear = new Date().getUTCFullYear();
  const hire = (await ctx.db.employee.findFirst({ where: { id: employeeId }, select: { hireDate: true } }))?.hireDate;
  const out: { year: number; type: string; entitlement: number; carryOver: number; taken: number; pending: number; remaining: number }[] = [];
  for (let y = thisYear; y > thisYear - years; y--) {
    if (hire && hire.getUTCFullYear() > y) break;
    for (const b of await leaveBalances(ctx, employeeId, y, new Date(Date.UTC(y, 11, 31)))) {
      if (!b.capped) continue;
      out.push({ year: y, type: b.type.name, entitlement: num(b.entitlement), carryOver: b.carryOver, taken: num(b.taken), pending: num(b.pending), remaining: num(b.remaining) });
    }
  }
  return out;
}
