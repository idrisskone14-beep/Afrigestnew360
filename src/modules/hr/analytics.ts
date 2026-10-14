import "server-only";
import type { TenantContext } from "@/core/tenant/context";
import { loadCalendar } from "./calendar";
import { canSeePay } from "./employees";
import { absencePeak, ageBrackets, averageTenureYears, headcountAt, isoDate, monthlyMovements, pct, spreadLeaveDays, turnoverRate } from "./hr-metrics";
import { computeBalance, workingDays, type LeaveRow, type LeaveRule } from "./leave-calc";

type Ctx = TenantContext;
const DAY = 86_400_000;
const utc = (y: number, m0: number, dd: number) => new Date(Date.UTC(y, m0, dd));
const day = (v: Date) => utc(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
const num = (v: unknown) => Number(v ?? 0);

// ═══ Indicateurs RH ═══════════════════════════════════════════

export interface HrIndicators {
  year: number;
  asOf: string;
  headcount: { start: number; end: number };
  entries: number;
  exits: number;
  turnoverPct: number | null;
  tenureYears: number | null;
  movements: { month: string; headcount: number; entries: number; exits: number }[];
  ages: { label: string; count: number }[];
  byDepartment: { id: string | null; name: string; headcount: number; gross: number | null }[];
  exitReasons: { reason: string; count: number }[];
  attendance: null | { tracked: number; absent: number; late: number; half: number; remote: number; absentPct: number | null; byMonth: { month: string; absent: number }[] };
  leave: { daysTaken: number; requests: number; ratePct: number | null; byMonth: number[]; byType: { name: string; days: number }[] };
  pay: null | {
    source: "payroll" | "estimate";
    byMonth: { month: string; gross: number; net: number; employerCost: number; payslips: number }[];
    totals: { gross: number; net: number; employerCost: number };
    avgGrossPerEmployee: number | null;
    employerOnGrossPct: number | null;
  };
}

/** Indicateurs RH d'une année : effectifs, rotation, absentéisme, congés et — pour qui voit les salaires — masse salariale. */
export async function hrIndicators(ctx: Ctx, year: number): Promise<HrIndicators> {
  const jan1 = utc(year, 0, 1), dec31 = utc(year, 11, 31);
  const today = day(new Date());
  const asOf = today < dec31 ? (today < jan1 ? jan1 : today) : dec31;
  const seePay = canSeePay(ctx) && ctx.hasModule("payroll");
  const seeAttendance = ctx.can("hr.attendance.read") || ctx.can("hr.employee.read");

  const [employees, departments, leaves, cal] = await Promise.all([
    ctx.db.employee.findMany({ where: { deletedAt: null, hireDate: { lte: dec31 }, OR: [{ endDate: null }, { endDate: { gte: jan1 } }] }, select: { id: true, hireDate: true, endDate: true, birthDate: true, departmentId: true, baseSalary: true, terminationReason: true } }),
    ctx.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ctx.db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: dec31 }, endDate: { gte: jan1 } }, select: { startDate: true, endDate: true, days: true, type: { select: { name: true } } } }),
    loadCalendar(ctx.db, jan1, dec31),
  ]);

  const headStart = headcountAt(employees, new Date(jan1.getTime() - DAY));
  const headEnd = headcountAt(employees, asOf);
  const exits = employees.filter((e) => e.endDate && e.endDate >= jan1 && e.endDate <= dec31 && e.endDate <= asOf);
  const entries = employees.filter((e) => e.hireDate >= jan1 && e.hireDate <= asOf).length;
  const deptName = new Map(departments.map((x) => [x.id, x.name]));

  const reasons = new Map<string, number>();
  for (const e of exits) { const r = e.terminationReason?.trim() || "Non précisé"; reasons.set(r, (reasons.get(r) ?? 0) + 1); }

  // — présences
  let attendance: HrIndicators["attendance"] = null;
  if (seeAttendance) {
    const rows = await ctx.db.attendance.groupBy({ by: ["date", "status"], where: { date: { gte: jan1, lte: dec31 } }, _count: true });
    const by = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + r._count, 0);
    const tracked = rows.reduce((a, r) => a + r._count, 0);
    const monthly = Array.from({ length: 12 }, (_, m) => ({ month: `${year}-${String(m + 1).padStart(2, "0")}`, absent: 0 }));
    for (const r of rows) if (r.status === "ABSENT") monthly[r.date.getUTCMonth()]!.absent += r._count;
    attendance = { tracked, absent: by("ABSENT"), late: by("LATE"), half: by("HALF_DAY"), remote: by("REMOTE"), absentPct: pct(by("ABSENT"), tracked), byMonth: monthly };
  }

  // — congés
  const leaveRows = leaves.map((l) => ({ startDate: l.startDate, endDate: l.endDate, days: num(l.days) }));
  const inYear = leaves.filter((l) => l.startDate >= jan1);
  const daysTaken = inYear.reduce((a, l) => a + num(l.days), 0);
  const byType = new Map<string, number>();
  for (const l of inYear) byType.set(l.type.name, (byType.get(l.type.name) ?? 0) + num(l.days));
  const avgHead = (headStart + headEnd) / 2;
  const theoretical = avgHead * workingDays(jan1, asOf, cal);

  // — masse salariale
  let pay: HrIndicators["pay"] = null;
  const grossByDept = new Map<string | null, number>();
  if (seePay) {
    const slips = await ctx.db.payslip.findMany({
      where: { run: { year, status: { in: ["VALIDATED", "PAID"] } } },
      select: { gross: true, netPay: true, employerCost: true, run: { select: { month: true } }, employee: { select: { departmentId: true } } },
    });
    if (slips.length > 0) {
      const months = Array.from({ length: 12 }, (_, m) => ({ month: `${year}-${String(m + 1).padStart(2, "0")}`, gross: 0, net: 0, employerCost: 0, payslips: 0 }));
      for (const s of slips) {
        const m = months[s.run.month - 1]!;
        m.gross += num(s.gross); m.net += num(s.netPay); m.employerCost += num(s.employerCost); m.payslips++;
        grossByDept.set(s.employee.departmentId, (grossByDept.get(s.employee.departmentId) ?? 0) + num(s.gross));
      }
      const totals = months.reduce((a, m) => ({ gross: a.gross + m.gross, net: a.net + m.net, employerCost: a.employerCost + m.employerCost }), { gross: 0, net: 0, employerCost: 0 });
      const last = [...months].reverse().find((m) => m.payslips > 0)!;
      pay = { source: "payroll", byMonth: months, totals, avgGrossPerEmployee: last.payslips ? Math.round(last.gross / last.payslips) : null, employerOnGrossPct: pct(totals.employerCost - totals.gross, totals.gross) };
    } else {
      // pas encore de paie validée : estimation sur les salaires de base des salariés présents
      const present = employees.filter((e) => e.hireDate <= asOf && (!e.endDate || e.endDate >= asOf));
      const monthly = present.reduce((a, e) => a + num(e.baseSalary), 0);
      for (const e of present) grossByDept.set(e.departmentId, (grossByDept.get(e.departmentId) ?? 0) + num(e.baseSalary));
      pay = { source: "estimate", byMonth: [], totals: { gross: Math.round(monthly), net: 0, employerCost: 0 }, avgGrossPerEmployee: present.length ? Math.round(monthly / present.length) : null, employerOnGrossPct: null };
    }
  }

  const present = employees.filter((e) => e.hireDate <= asOf && (!e.endDate || e.endDate >= asOf));
  const deptIds = new Set<string | null>(present.map((e) => e.departmentId));
  return {
    year, asOf: isoDate(asOf),
    headcount: { start: headStart, end: headEnd }, entries, exits: exits.length, turnoverPct: turnoverRate(exits.length, headStart, headEnd),
    tenureYears: averageTenureYears(employees, asOf), movements: monthlyMovements(employees, year, asOf), ages: ageBrackets(employees, asOf),
    byDepartment: [...deptIds].map((id) => ({ id, name: id ? deptName.get(id) ?? "Département supprimé" : "Sans département", headcount: present.filter((e) => e.departmentId === id).length, gross: pay ? Math.round(grossByDept.get(id) ?? 0) : null })).sort((a, b) => b.headcount - a.headcount),
    exitReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    attendance,
    leave: { daysTaken: Math.round(daysTaken * 10) / 10, requests: inYear.length, ratePct: pct(daysTaken, theoretical), byMonth: spreadLeaveDays(leaveRows, year), byType: [...byType].map(([name, days]) => ({ name, days: Math.round(days * 10) / 10 })).sort((a, b) => b.days - a.days) },
    pay,
  };
}

// ═══ Suivi des congés ═════════════════════════════════════════

export interface LeaveCell { status: "APPROVED" | "PENDING"; type: string; paid: boolean }
export interface LeaveOverview {
  year: number;
  month: number;
  days: { date: string; dow: number; day: number; holiday: string | null; off: boolean }[];
  rows: { id: string; name: string; number: string; department: string | null; cells: Record<string, LeaveCell> }[];
  absentPerDay: Record<string, number>;
  peak: { max: number; dates: string[] };
  kpis: { onLeaveToday: number; upcoming30: number; pendingCount: number; pendingDays: number; daysTakenYear: number; usagePct: number | null };
  pending: { id: string; employeeId: string; name: string; type: string; startDate: string; endDate: string; days: number }[];
  balances: { id: string; name: string; number: string; department: string | null; entitlement: number; carryOver: number; carryExpiresOn: string | null; taken: number; pending: number; remaining: number; available: number }[];
  balanceType: { id: string; name: string; accrual: "UPFRONT" | "MONTHLY" } | null;
  types: { id: string; name: string; capped: boolean }[];
  departments: { id: string; name: string }[];
}

/** Suivi des congés : calendrier d'absences du mois, pic d'absence, demandes en attente, soldes de chaque salarié pour un type de congé. */
export async function leaveOverview(ctx: Ctx, p: { year: number; month: number; departmentId?: string; typeId?: string }): Promise<LeaveOverview> {
  const monthStart = utc(p.year, p.month - 1, 1), monthEnd = utc(p.year, p.month, 0);
  const today = day(new Date());
  const yearStart = utc(p.year, 0, 1), yearEnd = utc(p.year, 11, 31);
  const [types, departments, employees, monthReqs, pendingReqs, cal, upcoming, todayReqs, yearApproved] = await Promise.all([
    ctx.db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    ctx.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({
      where: { deletedAt: null, hireDate: { lte: yearEnd }, OR: [{ endDate: null }, { endDate: { gte: yearStart } }], ...(p.departmentId ? { departmentId: p.departmentId } : {}) },
      select: { id: true, firstName: true, lastName: true, number: true, hireDate: true, endDate: true, departmentId: true, department: { select: { name: true } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500,
    }),
    ctx.db.leaveRequest.findMany({ where: { status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: monthEnd }, endDate: { gte: monthStart } }, select: { employeeId: true, startDate: true, endDate: true, status: true, type: { select: { name: true, paid: true } } } }),
    ctx.db.leaveRequest.findMany({ where: { status: "PENDING" }, orderBy: { startDate: "asc" }, take: 50, select: { id: true, employeeId: true, startDate: true, endDate: true, days: true, type: { select: { name: true } }, employee: { select: { firstName: true, lastName: true } } } }),
    loadCalendar(ctx.db, monthStart, monthEnd),
    ctx.db.leaveRequest.count({ where: { status: "APPROVED", startDate: { gt: today, lte: new Date(today.getTime() + 30 * DAY) } } }),
    ctx.db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } }, select: { employeeId: true } }),
    ctx.db.leaveRequest.aggregate({ where: { status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } }, _sum: { days: true } }),
  ]);

  const holidayNames = new Map((await ctx.db.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } }, select: { date: true, name: true } })).map((h) => [isoDate(h.date), h.name]));
  const daysList = Array.from({ length: monthEnd.getUTCDate() }, (_, i) => {
    const dt = utc(p.year, p.month - 1, i + 1);
    const iso = isoDate(dt);
    return { date: iso, dow: dt.getUTCDay(), day: i + 1, holiday: holidayNames.get(iso) ?? null, off: !cal.workDays.has(dt.getUTCDay()) };
  });

  const ids = new Set(employees.map((e) => e.id));
  const byEmp = new Map<string, typeof monthReqs>();
  for (const r of monthReqs) if (ids.has(r.employeeId)) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
  const absentPerDay = new Map<string, number>();
  const rows = employees.map((e) => {
    const cells: Record<string, LeaveCell> = {};
    for (const r of byEmp.get(e.id) ?? []) {
      for (const dd of daysList) {
        const dt = new Date(`${dd.date}T00:00:00.000Z`);
        if (dt < r.startDate || dt > r.endDate || dd.off || dd.holiday) continue; // jours non travaillés : pas de case colorée
        if (cells[dd.date]?.status === "APPROVED") continue;
        cells[dd.date] = { status: r.status as LeaveCell["status"], type: r.type.name, paid: r.type.paid };
        if (r.status === "APPROVED") absentPerDay.set(dd.date, (absentPerDay.get(dd.date) ?? 0) + 1);
      }
    }
    return { id: e.id, name: `${e.lastName} ${e.firstName}`, number: e.number, department: e.department?.name ?? null, cells };
  });

  // — soldes (un type de congé à la fois), calculés en une requête pour tous les salariés
  const capped = types.filter((t) => num(t.annualDays) > 0);
  const chosen = types.find((t) => t.id === p.typeId) ?? capped.find((t) => t.paid) ?? capped[0] ?? null;
  let balances: LeaveOverview["balances"] = [];
  let usagePct: number | null = null;
  if (chosen && num(chosen.annualDays) > 0) {
    const reqs = await ctx.db.leaveRequest.findMany({
      where: { typeId: chosen.id, status: { in: ["APPROVED", "PENDING"] }, endDate: { gte: utc(p.year - 6, 0, 1), lte: yearEnd } },
      select: { employeeId: true, status: true, days: true, endDate: true },
    });
    const byEmployee = new Map<string, LeaveRow[]>();
    for (const r of reqs) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), { year: r.endDate.getUTCFullYear(), status: r.status as "APPROVED" | "PENDING", days: num(r.days), endDate: r.endDate }]);
    const rule: LeaveRule = { annualDays: num(chosen.annualDays), accrual: chosen.accrual, carryOverMax: num(chosen.carryOverMax), carryOverExpiryMonth: chosen.carryOverExpiryMonth };
    const ref = new Date(Math.min(Math.max(today.getTime(), yearStart.getTime()), yearEnd.getTime()));
    balances = employees.filter((e) => e.hireDate <= yearEnd && (!e.endDate || e.endDate >= yearStart)).map((e) => {
      const b = computeBalance(rule, e, p.year, ref, byEmployee.get(e.id) ?? []);
      return { id: e.id, name: `${e.lastName} ${e.firstName}`, number: e.number, department: e.department?.name ?? null, entitlement: b.entitlement, carryOver: b.carryOver, carryExpiresOn: b.carryExpiresOn ? isoDate(b.carryExpiresOn) : null, taken: b.taken, pending: b.pending, remaining: b.remaining, available: b.available };
    });
    const ent = balances.reduce((a, b) => a + b.entitlement + b.carryOver, 0);
    usagePct = pct(balances.reduce((a, b) => a + b.taken, 0), ent);
  }

  return {
    year: p.year, month: p.month, days: daysList, rows, absentPerDay: Object.fromEntries(absentPerDay), peak: absencePeak(absentPerDay),
    kpis: {
      onLeaveToday: new Set(todayReqs.map((r) => r.employeeId)).size, upcoming30: upcoming, pendingCount: pendingReqs.length, pendingDays: pendingReqs.reduce((a, r) => a + num(r.days), 0),
      daysTakenYear: Math.round(num(yearApproved._sum.days) * 10) / 10, usagePct,
    },
    pending: pendingReqs.map((r) => ({ id: r.id, employeeId: r.employeeId, name: `${r.employee.lastName} ${r.employee.firstName}`, type: r.type.name, startDate: isoDate(r.startDate), endDate: isoDate(r.endDate), days: num(r.days) })),
    balances: balances.sort((a, b) => a.available - b.available),
    balanceType: chosen ? { id: chosen.id, name: chosen.name, accrual: chosen.accrual } : null,
    types: types.map((t) => ({ id: t.id, name: t.name, capped: num(t.annualDays) > 0 })),
    departments,
  };
}
