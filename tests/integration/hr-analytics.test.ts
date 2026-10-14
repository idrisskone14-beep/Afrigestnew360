import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { hrIndicators, leaveOverview } from "@/modules/hr/analytics";
import { addHoliday, holidaySchema } from "@/modules/hr/calendar";
import * as emp from "@/modules/hr/employees";
import * as lv from "@/modules/hr/leave";
import * as pp from "@/modules/hr/people";
import { attendanceSchema, employeeSchema } from "@/modules/hr/schemas";
import { runSchema } from "@/modules/payroll/schemas";
import * as pay from "@/modules/payroll/service";
import * as org from "@/modules/org/service";
import { addMember, ctxFor, makeCompany } from "../helpers";

const Y = 2025; // année révolue : les indicateurs sont stables quelle que soit la date d'exécution

async function setup() {
  const co = await makeCompany("INDICATEURS", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const dept = await org.createDepartment(ctx, { name: "Finance", code: "FIN" } as never);
  const dept2 = await org.createDepartment(ctx, { name: "Technique", code: "TEC" } as never);
  const hire = (name: string, hireDate: string, over: Record<string, unknown> = {}) => emp.createEmployee(ctx, employeeSchema.parse({ firstName: name, lastName: "Test", hireDate, baseSalary: 300000, jobTitle: "Poste", ...over }));
  return { ...co, ctx, dept, dept2, hire };
}
type S = Awaited<ReturnType<typeof setup>>;

/** A et B présents au 1er janvier ; B part le 30 juin ; C (février) et D (septembre) arrivent. */
async function team(s: S) {
  const a = await s.hire("Aminata", "2019-04-01", { departmentId: s.dept.id, birthDate: "1988-02-10" });
  const b = await s.hire("Bakary", "2020-01-06", { departmentId: s.dept.id, birthDate: "1995-09-01" });
  const c = await s.hire("Clarisse", "2025-02-03", { departmentId: s.dept2.id });
  const dd = await s.hire("Didier", "2025-09-01", { departmentId: s.dept2.id });
  await emp.terminateEmployee(s.ctx, { id: b.id, endDate: "2025-06-30", reason: "Démission" });
  return { a, b, c, d: dd };
}

describe("indicateurs RH", () => {
  it("effectifs, mouvements, rotation, ancienneté et répartition par département", async () => {
    const s = await setup();
    await team(s);
    const r = await hrIndicators(s.ctx, Y);
    expect(r.headcount).toEqual({ start: 2, end: 3 });
    expect(r.entries).toBe(2);
    expect(r.exits).toBe(1);
    expect(r.turnoverPct).toBe(40); // 1 ÷ ((2 + 3) / 2)
    expect(r.movements).toHaveLength(12);
    expect(r.movements[1]).toMatchObject({ month: "2025-02", entries: 1, headcount: 3 });
    expect(r.movements[5]).toMatchObject({ month: "2025-06", exits: 1, headcount: 3 }); // le jour de départ compte encore comme présent
    expect(r.movements[6]).toMatchObject({ month: "2025-07", headcount: 2 });
    expect(r.movements[11]).toMatchObject({ headcount: 3 });
    expect(r.exitReasons).toEqual([{ reason: "Démission", count: 1 }]);
    expect(Object.fromEntries(r.byDepartment.map((d) => [d.name, d.headcount]))).toEqual({ Finance: 1, Technique: 2 });
    expect(r.tenureYears).toBeGreaterThan(0);
    expect(r.ages.find((x) => x.label === "35 à 44 ans")!.count).toBe(1); // Aminata, 37 ans fin 2025
  });

  it("absentéisme (jours pointés) et congés pris", async () => {
    const s = await setup();
    const t = await team(s);
    const at = (employeeId: string, date: string, status: "PRESENT" | "ABSENT") => pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId, date, status }));
    for (const date of ["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07", "2025-03-10", "2025-03-11", "2025-03-12"]) await at(t.a.id, date, "PRESENT");
    await at(t.a.id, "2025-03-13", "ABSENT");
    await at(t.a.id, "2025-04-01", "ABSENT");
    const annual = (await lv.listLeaveTypes(s.ctx)).find((x) => x.name === "Congé annuel")!;
    await lv.requestLeave(s.ctx, { employeeId: t.a.id, typeId: annual.id, startDate: "2025-05-05", endDate: "2025-05-09", reason: "" });
    const r = await hrIndicators(s.ctx, Y);
    expect(r.attendance).toMatchObject({ tracked: 10, absent: 2, absentPct: 20 });
    expect(r.attendance!.byMonth[2]!.absent).toBe(1);
    expect(r.attendance!.byMonth[3]!.absent).toBe(1);
    expect(r.leave.daysTaken).toBe(5);
    expect(r.leave.requests).toBe(1);
    expect(r.leave.byType).toEqual([{ name: "Congé annuel", days: 5 }]);
    expect(r.leave.byMonth[4]).toBe(5);
    expect(r.leave.ratePct).toBeGreaterThan(0);
  });

  it("masse salariale : estimation sur les salaires de base, puis chiffres réels de la paie validée", async () => {
    const s = await setup();
    await team(s);
    const est = await hrIndicators(s.ctx, Y);
    expect(est.pay).toMatchObject({ source: "estimate", totals: { gross: 900000 } }); // 3 salariés présents × 300 000
    expect(est.pay!.avgGrossPerEmployee).toBe(300000);

    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: 11 }));
    await pay.validateRun(s.ctx, run.id);
    const real = await hrIndicators(s.ctx, Y);
    expect(real.pay!.source).toBe("payroll");
    expect(real.pay!.byMonth[10]).toMatchObject({ month: "2025-11", payslips: 3, gross: 900000 });
    expect(real.pay!.totals.gross).toBe(900000);
    expect(Object.fromEntries(real.byDepartment.map((d) => [d.name, d.gross]))).toEqual({ Finance: 300000, Technique: 600000 });
  });

  it("sans droit sur les salaires ni les présences, ces chiffres ne sont pas renvoyés", async () => {
    const s = await setup();
    await team(s);
    const acc = await addMember(s.company.id, "accountant");
    const ctx = await ctxFor(acc.user.id, s.company.id);
    const r = await hrIndicators(ctx, Y);
    expect(r.pay).toBeNull();
    expect(r.attendance).toBeNull();
    expect(r.headcount.end).toBe(3); // les effectifs, eux, restent visibles de qui ouvre la page
  });

  it("deux entreprises ne se voient pas", async () => {
    const A = await setup();
    const B = await setup();
    await team(A);
    expect((await hrIndicators(B.ctx, Y)).headcount).toEqual({ start: 0, end: 0 });
  });
});

describe("suivi des congés", () => {
  it("calendrier du mois : jours fériés et week-ends sans case, absents du jour, pic d'absence, demandes en attente", async () => {
    const s = await setup();
    const t = await team(s);
    const annual = (await lv.listLeaveTypes(s.ctx)).find((x) => x.name === "Congé annuel")!;
    await addHoliday(s.ctx, holidaySchema.parse({ date: "2025-03-12", name: "Férié test" }));
    await lv.requestLeave(s.ctx, { employeeId: t.a.id, typeId: annual.id, startDate: "2025-03-10", endDate: "2025-03-14", reason: "" }); // 4 jours (férié exclu), approuvé d'office
    await lv.requestLeave(s.ctx, { employeeId: t.c.id, typeId: annual.id, startDate: "2025-03-11", endDate: "2025-03-13", reason: "" }); // 2 jours : 11 et 13
    await platformDb.leaveRequest.create({ data: { companyId: s.company.id, employeeId: t.d.id, typeId: annual.id, startDate: new Date("2025-03-17T00:00:00Z"), endDate: new Date("2025-03-18T00:00:00Z"), days: 2, status: "PENDING" } });

    const o = await leaveOverview(s.ctx, { year: Y, month: 3 });
    expect(o.days).toHaveLength(31);
    expect(o.days.find((x) => x.date === "2025-03-12")!.holiday).toBe("Férié test");
    expect(o.days.find((x) => x.date === "2025-03-15")!.off).toBe(true); // samedi
    const a = o.rows.find((r) => r.id === t.a.id)!;
    expect(Object.keys(a.cells).sort()).toEqual(["2025-03-10", "2025-03-11", "2025-03-13", "2025-03-14"]);
    expect(o.absentPerDay["2025-03-11"]).toBe(2);
    expect(o.peak).toEqual({ max: 2, dates: ["2025-03-11", "2025-03-13"] });
    const d = o.rows.find((r) => r.id === t.d.id)!;
    expect(d.cells["2025-03-17"]).toMatchObject({ status: "PENDING" });
    expect(o.pending).toHaveLength(1);
    expect(o.kpis.pendingCount).toBe(1);
    expect(o.kpis.pendingDays).toBe(2);
    expect(o.kpis.daysTakenYear).toBe(6);
  });

  it("filtre par département et soldes triés du plus bas au plus haut, avec report et acquisition", async () => {
    const s = await setup();
    const t = await team(s);
    const annual = (await lv.listLeaveTypes(s.ctx)).find((x) => x.name === "Congé annuel")!;
    await lv.updateLeaveType(s.ctx, { id: annual.id, name: annual.name, annualDays: 24, paid: true, isActive: true, accrual: "UPFRONT", carryOverMax: 5, carryOverExpiryMonth: null });
    await lv.requestLeave(s.ctx, { employeeId: t.a.id, typeId: annual.id, startDate: "2025-08-04", endDate: "2025-08-15", reason: "" }); // 10 jours

    const all = await leaveOverview(s.ctx, { year: Y, month: 8, typeId: annual.id });
    expect(all.balanceType).toMatchObject({ name: "Congé annuel" });
    const byName = Object.fromEntries(all.balances.map((b) => [b.name, b]));
    expect(byName["Test Aminata"]).toMatchObject({ entitlement: 24, taken: 10, remaining: 14 + byName["Test Aminata"]!.carryOver });
    expect(byName["Test Aminata"]!.carryOver).toBe(5); // reliquat 2024 plafonné à 5 (aucun jour pris)
    expect(all.balances[0]!.available).toBeLessThanOrEqual(all.balances[all.balances.length - 1]!.available);
    expect(byName["Test Clarisse"]!.entitlement).toBeLessThan(24); // arrivée en février : proratisé
    expect(all.kpis.usagePct).toBeGreaterThan(0);

    const fin = await leaveOverview(s.ctx, { year: Y, month: 8, departmentId: s.dept.id, typeId: annual.id });
    expect(fin.rows.map((r) => r.name).sort()).toEqual(["Test Aminata", "Test Bakary"]);
    expect(fin.departments.map((x) => x.name)).toEqual(["Finance", "Technique"]);
  });

  it("deux entreprises ne se voient pas", async () => {
    const A = await setup();
    const B = await setup();
    await team(A);
    const o = await leaveOverview(B.ctx, { year: Y, month: 3 });
    expect(o.rows).toHaveLength(0);
    expect(o.pending).toHaveLength(0);
  });
});
