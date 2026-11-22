import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as ab from "@/modules/hr/absences";
import * as ac from "@/modules/hr/accidents";
import { equipmentSchema, medicalVisitSchema, overtimeSchema } from "@/modules/hr/admin-schemas";
import { hrAlerts } from "@/modules/hr/alerts";
import * as emp from "@/modules/hr/employees";
import * as eq from "@/modules/hr/equipment";
import { HR_EXPORTERS } from "@/modules/hr/exports";
import * as la from "@/modules/hr/lateness";
import * as lv from "@/modules/hr/leave";
import * as mv from "@/modules/hr/medvisits";
import * as ot from "@/modules/hr/overtime";
import { leaveBalanceReport, leaveEntitlementHistory, monthlyReport } from "@/modules/hr/reports";
import { absenceSchema, accidentSchema, latenessSchema, sickLeaveSchema, timeOffSchema } from "@/modules/hr/registers-schemas";
import { employeeSchema } from "@/modules/hr/schemas";
import * as sk from "@/modules/hr/sickleave";
import * as to from "@/modules/hr/timeoff";
import { addMember, ctxFor, makeCompany } from "../helpers";

async function setup() {
  const co = await makeCompany("RAPPORTS RH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const e = await emp.createEmployee(ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 440000, jobTitle: "Comptable" }));
  const f = await emp.createEmployee(ctx, employeeSchema.parse({ firstName: "Moussa", lastName: "Traoré", hireDate: "2020-01-06", baseSalary: 300000 }));
  return { ...co, ctx, e, f };
}

describe("rapports RH consolidés", () => {
  it("rapport mensuel : congés, permissions, absences, arrêts, retards, heures supplémentaires, accidents ; totaux ; export", async () => {
    const s = await setup();
    const lt = (await lv.listLeaveTypes(s.ctx)).find((t) => t.name === "Congé annuel")!;
    await lv.requestLeave(s.ctx, { employeeId: s.e.id, typeId: lt.id, startDate: "2026-03-02", endDate: "2026-03-06", reason: "" }); // 5 j
    const tt = await to.createTimeOffType(s.ctx, { name: "RDV", paid: true, requiresProof: false } as never);
    const off = (over: Record<string, unknown>) => to.createTimeOff(s.ctx, timeOffSchema.parse({ employeeId: s.e.id, typeId: tt.id, unit: "DAILY", reason: "Test", submit: true, ...over }));
    await off({ startDate: "2026-03-09", endDate: "2026-03-10" }); // 2 j
    await off({ unit: "HOURLY", startDate: "2026-03-11", startTime: "09:00", endDate: "2026-03-11", endTime: "11:30" }); // 2,5 h
    const un = await ab.createAbsenceType(s.ctx, { name: "Injustifiée", category: "UNJUSTIFIED", requiresValidation: false, requiresProof: false });
    const ot2 = await ab.createAbsenceType(s.ctx, { name: "Autre", category: "OTHER", requiresValidation: false, requiresProof: false });
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: s.e.id, typeId: un.id, startDate: "2026-03-12", endDate: "2026-03-12" }));
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: s.e.id, typeId: ot2.id, startDate: "2026-03-13", endDate: "2026-03-13", halfDay: true }));
    await sk.createSickLeave(s.ctx, sickLeaveSchema.parse({ employeeId: s.e.id, startDate: "2026-03-23", expectedEndDate: "2026-03-27" })); // 5 j calendaires
    await sk.createSickLeave(s.ctx, sickLeaveSchema.parse({ employeeId: s.f.id, startDate: "2026-02-26", expectedEndDate: "2026-03-03" })); // à cheval : 3 j en mars
    await la.createLateness(s.ctx, latenessSchema.parse({ employeeId: s.e.id, date: "2026-03-16", actualTime: "08:30" }));
    await la.createLateness(s.ctx, latenessSchema.parse({ employeeId: s.e.id, date: "2026-03-17", actualTime: "09:00" }));
    const rate = await ot.createOvertimeRate(s.ctx, { name: "Taux", multiplier: 1.25 });
    await ot.createOvertime(s.ctx, overtimeSchema.parse({ employeeId: s.e.id, date: "2026-03-18", startTime: "18:00", endTime: "20:00", rateId: rate.id, reason: "Clôture", submit: true }));
    await ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: s.e.id, kind: "WORKPLACE", occurredOn: "2026-03-19", place: "Atelier", circumstances: "Chute pendant le rangement." }));

    const rep = await monthlyReport(s.ctx, 2026, 3);
    const a = rep.rows.find((r) => r.employeeId === s.e.id)!, b = rep.rows.find((r) => r.employeeId === s.f.id)!;
    expect(a).toMatchObject({ leaveDays: 5, timeOffDays: 2, timeOffHours: 2.5, absenceDays: 1.5, unjustifiedDays: 1, sickDays: 5, lateCount: 2, lateMinutes: 90, overtimeHours: 2, accidents: 1 });
    expect(b).toMatchObject({ leaveDays: 0, sickDays: 3, lateCount: 0, accidents: 0 });
    expect(rep.totals).toMatchObject({ leaveDays: 5, sickDays: 8, lateCount: 2, overtimeHours: 2, accidents: 1 });
    expect((await monthlyReport(s.ctx, 2026, 4)).rows.every((r) => r.leaveDays === 0 && r.accidents === 0)).toBe(true);
    await expect(monthlyReport(s.ctx, 2026, 13)).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const table = await HR_EXPORTERS["hr-rapport-mensuel"]!.build(s.ctx, (k) => (k === "mois" ? "2026-03" : undefined));
    expect(table.rows).toHaveLength(2);
    expect(table.totals).toMatchObject({ employee: "Total", leave: 5, sick: 8 });
  });

  it("colonnes selon les droits ; accès réservé à qui voit tous les salariés ; isolation", async () => {
    const s = await setup();
    const at = await ab.createAbsenceType(s.ctx, { name: "Autre", category: "OTHER", requiresValidation: false, requiresProof: false });
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: s.e.id, typeId: at.id, startDate: "2026-03-13", endDate: "2026-03-13" }));
    // « chef de projet » : lit les salariés (hr.employee.read) mais aucun registre RH
    const pm = await addMember(s.company.id, "project_manager");
    const pctx = await ctxFor(pm.user.id, s.company.id);
    const rep = await monthlyReport(pctx, 2026, 3);
    expect(rep.rows[0]).toMatchObject({ absenceDays: null, sickDays: null, lateCount: null, overtimeHours: null, accidents: null });
    expect(rep.totals.absenceDays).toBeNull();
    const self = await ctxFor((await addMember(s.company.id, "employee")).user.id, s.company.id);
    await expect(monthlyReport(self, 2026, 3)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await setup();
    expect((await monthlyReport(other.ctx, 2026, 3)).rows.map((r) => r.name).sort()).toEqual(["Koné Awa", "Traoré Moussa"]);
    expect((await monthlyReport(other.ctx, 2026, 3)).totals.absenceDays).toBe(0);
  });

  it("soldes de congés : historique des droits par année et rapport consolidé", async () => {
    const s = await setup();
    const lt = (await lv.listLeaveTypes(s.ctx)).find((t) => t.name === "Congé annuel")!;
    await lv.requestLeave(s.ctx, { employeeId: s.e.id, typeId: lt.id, startDate: "2026-03-02", endDate: "2026-03-06", reason: "" });
    const h = await leaveEntitlementHistory(s.ctx, s.e.id, 3);
    expect([...new Set(h.map((x) => x.year))]).toEqual([2026, 2025, 2024]);
    expect(h.find((x) => x.year === 2026 && x.type === "Congé annuel")).toMatchObject({ type: "Congé annuel", entitlement: Number(lt.annualDays), taken: 5, remaining: Number(lt.annualDays) - 5 });
    const rep = await leaveBalanceReport(s.ctx, 2026);
    expect(rep.find((r) => r.employeeId === s.e.id && r.type === "Congé annuel")).toMatchObject({ taken: 5, remaining: Number(lt.annualDays) - 5 });
    expect(rep.find((r) => r.employeeId === s.f.id && r.type === "Congé annuel")).toMatchObject({ taken: 0, remaining: Number(lt.annualDays) });
    const table = await HR_EXPORTERS["hr-soldes-conges"]!.build(s.ctx, (k) => (k === "annee" ? "2026" : undefined));
    expect(table.rows.length).toBe(rep.length);
  });
});

describe("alertes et échéances", () => {
  it("rassemble les alertes selon les droits ; rien d'automatique", async () => {
    const s = await setup();
    const today = new Date("2026-11-19T10:00:00Z");
    await sk.createSickLeave(s.ctx, sickLeaveSchema.parse({ employeeId: s.e.id, startDate: "2026-11-02", expectedEndDate: "2026-11-20", certificate: "ACCEPTED" }));
    const v = await mv.createVisit(s.ctx, medicalVisitSchema.parse({ employeeId: s.f.id, kind: "PERIODIC", scheduledOn: "2026-11-01" }));
    await eq.issueEquipment(s.ctx, equipmentSchema.parse({ employeeId: s.f.id, name: "Casque", quantity: 1, issuedOn: "2026-01-05", condition: "NEW", replaceOn: "2026-11-10" }));
    await ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: s.e.id, kind: "COMMUTE", occurredOn: "2026-11-03", place: "Route", circumstances: "Collision en rejoignant le bureau." }));
    const a = await hrAlerts(s.ctx, today);
    expect(a.sick).toHaveLength(1);
    expect(a.visits!.overdue.map((x) => x.id)).toEqual([v.id]);
    expect(a.equipment!.map((x) => x.alert)).toEqual(["replace_overdue"]);
    expect(a.accidents).toHaveLength(1);
    expect(a.count).toBe(4);
    expect(await platformDb.disciplinaryCase.count({ where: { companyId: s.company.id } })).toBe(0);

    // un salarié ne voit aucune section (absentes, pas vides) ; le chef de projet ne voit que les contrats
    const self = await ctxFor((await addMember(s.company.id, "employee")).user.id, s.company.id);
    const sa = await hrAlerts(self, today);
    expect([sa.sick, sa.visits, sa.equipment, sa.accidents, sa.contracts, sa.repeated, sa.lateness]).toEqual([null, null, null, null, null, null, null]);
    const other = await setup();
    expect((await hrAlerts(other.ctx, today)).count).toBe(0);
  });
});
