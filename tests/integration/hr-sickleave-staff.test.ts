import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as ab from "@/modules/hr/absences";
import * as emp from "@/modules/hr/employees";
import { HR_EXPORTERS } from "@/modules/hr/exports";
import * as la from "@/modules/hr/lateness";
import * as lv from "@/modules/hr/leave";
import { absenceSchema, assignmentSchema, extendSickLeaveSchema, latenessSchema, returnSickLeaveSchema, sickLeaveSchema, timeOffSchema, updateSickLeaveSchema } from "@/modules/hr/registers-schemas";
import { contractSchema, employeeSchema, leaveTypeSchema } from "@/modules/hr/schemas";
import * as sk from "@/modules/hr/sickleave";
import * as st from "@/modules/hr/staff";
import * as to from "@/modules/hr/timeoff";
import * as org from "@/modules/org/service";
import { addMember, ctxFor, makeCompany } from "../helpers";

async function setup() {
  const co = await makeCompany("ARRETS RH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  return { ...co, ctx };
}
type S = Awaited<ReturnType<typeof setup>>;
const newEmp = (s: S, over: Record<string, unknown> = {}) => emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000, jobTitle: "Comptable", ...over }));
const sick = (employeeId: string, over: Record<string, unknown> = {}) => sickLeaveSchema.parse({ employeeId, startDate: "2026-03-02", expectedEndDate: "2026-03-13", ...over });
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("arrêts maladie", () => {
  it("création : durée en jours calendaires, journal d'audit ; dates incohérentes refusées", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await sk.createSickLeave(s.ctx, sick(e.id));
    expect(a).toMatchObject({ status: "ONGOING", certificate: "PENDING" });
    expect(sk.sickCalendarDays(a)).toBe(12);
    await expect(sk.createSickLeave(s.ctx, sick(e.id, { startDate: "2026-03-20", expectedEndDate: "2026-03-10" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("précède") });
    await expect(sk.createSickLeave(s.ctx, sick(e.id, { startDate: "2019-01-01", expectedEndDate: "2019-01-05" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("embauche") });
    await expect(sk.createSickLeave(s.ctx, sick(e.id, { startDate: "2026-03-10", expectedEndDate: "2026-03-20" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche un arrêt maladie") });
    expect(await platformDb.auditLog.count({ where: { companyId: s.company.id, action: "hr.sickleave.create" } })).toBe(1);
  });

  it("prolongation historisée ; raccourcissement refusé ; reprise anticipée libère les jours ; arrêt terminé non modifiable", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await sk.createSickLeave(s.ctx, sick(e.id));
    await expect(sk.extendSickLeave(s.ctx, extendSickLeaveSchema.parse({ id: a.id, newEnd: "2026-03-13" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("dépasser") });
    await sk.extendSickLeave(s.ctx, extendSickLeaveSchema.parse({ id: a.id, newEnd: "2026-03-20", note: "Prolongation reçue" }));
    await sk.extendSickLeave(s.ctx, extendSickLeaveSchema.parse({ id: a.id, newEnd: "2026-03-27" }));
    const got = await sk.getSickLeave(s.ctx, a.id);
    expect(got.expectedEndDate.toISOString().slice(0, 10)).toBe("2026-03-27");
    expect(got.extensions.map((x) => [x.previousEnd.toISOString().slice(0, 10), x.newEnd.toISOString().slice(0, 10)])).toEqual([["2026-03-13", "2026-03-20"], ["2026-03-20", "2026-03-27"]]);
    await expect(sk.updateSickLeave(s.ctx, updateSickLeaveSchema.parse({ id: a.id, startDate: "2026-03-02", expectedEndDate: "2026-03-10" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("prolongé") });
    await sk.updateSickLeave(s.ctx, updateSickLeaveSchema.parse({ id: a.id, startDate: "2026-03-02", expectedEndDate: "2026-03-27", certificate: "ACCEPTED", observations: "Certificat reçu" }));

    // période occupée jusqu'à la fin prévue ; une reprise anticipée la libère
    const t = await to.createTimeOffType(s.ctx, { name: "RDV", paid: true, requiresProof: false } as never);
    const off = (startDate: string) => timeOffSchema.parse({ employeeId: e.id, typeId: t.id, unit: "DAILY", startDate, endDate: startDate, reason: "Test" });
    await expect(to.createTimeOff(s.ctx, off("2026-03-25"))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("arrêt maladie") });
    await expect(sk.recordReturn(s.ctx, returnSickLeaveSchema.parse({ id: a.id, returnDate: "2026-03-02" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("suivre") });
    await expect(sk.recordReturn(s.ctx, returnSickLeaveSchema.parse({ id: a.id, returnDate: "2999-01-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("à l'avance") });
    await sk.recordReturn(s.ctx, returnSickLeaveSchema.parse({ id: a.id, returnDate: "2026-03-23" })); // lundi 23 : dernier jour d'arrêt = dimanche 22
    const ended = await sk.getSickLeave(s.ctx, a.id);
    expect(ended.status).toBe("ENDED");
    expect(sk.sickCalendarDays(ended)).toBe(21);
    await to.createTimeOff(s.ctx, off("2026-03-25")); // jour libéré
    await expect(to.createTimeOff(s.ctx, off("2026-03-20"))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("arrêt maladie") });
    await expect(sk.extendSickLeave(s.ctx, extendSickLeaveSchema.parse({ id: a.id, newEnd: "2026-04-30" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("terminé") });
    await expect(sk.updateSickLeave(s.ctx, updateSickLeaveSchema.parse({ id: a.id, startDate: "2026-03-02", expectedEndDate: "2026-03-27" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("chevauchements dans les deux sens : congé, absence ; un arrêt annulé ne bloque plus", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const lt = await lv.createLeaveType(s.ctx, leaveTypeSchema.parse({ name: "Congé test", annualDays: 30, paid: true }));
    await lv.requestLeave(s.ctx, { employeeId: e.id, typeId: lt.id, startDate: "2027-05-03", endDate: "2027-05-07", reason: "" });
    await expect(sk.createSickLeave(s.ctx, sick(e.id, { startDate: "2027-05-05", expectedEndDate: "2027-05-10" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche un congé") });
    const at = await ab.createAbsenceType(s.ctx, { name: "Autre", category: "OTHER", requiresValidation: false, requiresProof: false });
    const a = await sk.createSickLeave(s.ctx, sick(e.id, { startDate: "2027-06-07", expectedEndDate: "2027-06-11" }));
    await expect(lv.requestLeave(s.ctx, { employeeId: e.id, typeId: lt.id, startDate: "2027-06-09", endDate: "2027-06-10", reason: "" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("arrêt maladie") });
    await expect(ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: e.id, typeId: at.id, startDate: "2027-06-08", endDate: "2027-06-08" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("arrêt maladie") });
    await sk.cancelSickLeave(s.ctx, a.id);
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: e.id, typeId: at.id, startDate: "2027-06-08", endDate: "2027-06-08" }));
    await expect(sk.cancelSickLeave(s.ctx, a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("alertes de reprise : arrêt proche de sa fin ou dépassé ; seuil paramétrable ; justificatif manquant", async () => {
    const e = new Date("2026-06-10T09:00:00Z");
    const base = { status: "ONGOING", returnDate: null, certificate: "ACCEPTED" };
    expect(sk.sickAlerts({ ...base, expectedEndDate: day("2026-06-20") }, e, 3)).toEqual([]);
    expect(sk.sickAlerts({ ...base, expectedEndDate: day("2026-06-12") }, e, 3).map((a) => a.code)).toEqual(["return_due"]);
    expect(sk.sickAlerts({ ...base, expectedEndDate: day("2026-06-10") }, e, 0).map((a) => a.code)).toEqual(["return_due"]);
    expect(sk.sickAlerts({ ...base, expectedEndDate: day("2026-06-08") }, e, 3).map((a) => a.code)).toEqual(["overdue"]);
    expect(sk.sickAlerts({ ...base, certificate: "PENDING", expectedEndDate: day("2026-06-30") }, e, 3).map((a) => a.code)).toEqual(["certificate"]);
    expect(sk.sickAlerts({ ...base, status: "ENDED", expectedEndDate: day("2026-06-08") }, e, 3)).toEqual([]);

    const s = await setup();
    const w = await newEmp(s);
    const a = await sk.createSickLeave(s.ctx, sick(w.id, { startDate: "2026-11-02", expectedEndDate: "2026-11-20" }));
    const b = await newEmp(s, { firstName: "Moussa", lastName: "Traoré" });
    await sk.createSickLeave(s.ctx, sick(b.id, { startDate: "2026-12-01", expectedEndDate: "2027-01-30", certificate: "ACCEPTED" }));
    const due = await sk.sickLeaveAlerts(s.ctx, new Date("2026-11-19T10:00:00Z"));
    expect(due.map((r) => r.id)).toEqual([a.id]); // le 20/11 est dans 1 jour ; l'autre est loin
  });

  it("intégration présences et absences : un arrêt apparaît dans « absents du jour » et exclut un retard ce jour-là", async () => {
    const s = await setup();
    const e = await newEmp(s);
    await sk.createSickLeave(s.ctx, sick(e.id, { startDate: "2026-04-06", expectedEndDate: "2026-04-10" }));
    expect((await ab.absentOn(s.ctx.db, day("2026-04-08"))).get(e.id)).toMatchObject({ label: "Arrêt maladie" });
    expect((await ab.absentOn(s.ctx.db, day("2026-04-13"))).has(e.id)).toBe(false);
    await expect(la.createLateness(s.ctx, latenessSchema.parse({ employeeId: e.id, date: "2026-04-08", actualTime: "09:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("absent") });
  });

  it("confidentialité : réservé aux droits « arrêts maladie » ; aucune donnée médicale stockée ; isolation ; export", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await sk.createSickLeave(s.ctx, sick(e.id));
    const m = await addMember(s.company.id, "employee");
    const self = await ctxFor(m.user.id, s.company.id);
    await expect(sk.listSickLeaves(self, { skip: 0, take: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sk.getSickLeave(self, a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sk.createSickLeave(self, sick(e.id, { startDate: "2026-09-07", expectedEndDate: "2026-09-08" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await setup();
    await expect(sk.getSickLeave(other.ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const cols = (await platformDb.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'SickLeave'`).map((c) => c.column_name);
    expect(cols.filter((c) => /diagnos|patholog|disease|maladie|medical/i.test(c))).toEqual([]);
    const table = await HR_EXPORTERS["hr-arrets-maladie"]!.build(s.ctx, () => undefined);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ employee: "Koné Awa", days: 12 });
  });
});

describe("registre du personnel et affectations", () => {
  const assignmentRows = (employeeId: string) => platformDb.employeeAssignment.findMany({ where: { employeeId }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] });

  it("embauche : première ligne d'historique ; modification de la fiche : ligne seulement si l'affectation change ; statut professionnel enregistré", async () => {
    const s = await setup();
    const dep = await org.createDepartment(s.ctx, { name: "Finance", code: "FIN" } as never);
    const e = await newEmp(s, { departmentId: dep.id, professionalCategory: "Cadre" });
    let rows = await assignmentRows(e.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "Embauche", jobTitle: "Comptable", departmentName: "Finance" });
    expect(rows[0]!.effectiveDate.toISOString().slice(0, 10)).toBe("2020-01-06");
    const { updateEmployeeSchema } = await import("@/modules/hr/schemas");
    const base = { id: e.id, firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000, jobTitle: "Comptable", departmentId: dep.id, professionalCategory: "Cadre" };
    await emp.updateEmployee(s.ctx, updateEmployeeSchema.parse({ ...base, phone: "0700000000" }));
    expect(await assignmentRows(e.id)).toHaveLength(1); // téléphone : pas une affectation
    await emp.updateEmployee(s.ctx, updateEmployeeSchema.parse({ ...base, jobTitle: "Chef comptable", professionalCategory: "Cadre supérieur" }));
    rows = await assignmentRows(e.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ jobTitle: "Chef comptable", reason: "Modification de la fiche" });
    expect((await emp.getEmployee(s.ctx, e.id)).professionalCategory).toBe("Cadre supérieur");
    // un nouveau contrat qui change le poste est tracé aussi
    await emp.addContract(s.ctx, contractSchema.parse({ employeeId: e.id, type: "PERMANENT", startDate: "2026-02-02", jobTitle: "Directeur financier", salary: 600000 }));
    rows = await assignmentRows(e.id);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.reason === "Nouveau contrat")).toMatchObject({ jobTitle: "Directeur financier" });
  });

  it("changement daté : met à jour la fiche, garde les noms d'époque ; dates, doublons et boucles refusés", async () => {
    const s = await setup();
    const d1 = await org.createDepartment(s.ctx, { name: "Ventes", code: "VTE" } as never);
    const d2 = await org.createDepartment(s.ctx, { name: "Logistique", code: "LOG" } as never);
    const boss = await newEmp(s, { firstName: "Chef", lastName: "Yao" });
    const e = await newEmp(s, { departmentId: d1.id });
    const change = (over: Record<string, unknown>) => st.changeAssignment(s.ctx, assignmentSchema.parse({ employeeId: e.id, effectiveDate: "2026-03-02", jobTitle: "Comptable", departmentId: d1.id, ...over }));
    await expect(change({})).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Aucun changement") });
    await expect(change({ departmentId: d2.id, effectiveDate: "2999-01-01" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("futur") });
    await expect(change({ departmentId: d2.id, effectiveDate: "2019-01-01" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("embauche") });
    await change({ departmentId: d2.id, managerId: boss.id, reason: "Réorganisation" });
    const cur = await emp.getEmployee(s.ctx, e.id);
    expect(cur).toMatchObject({ departmentId: d2.id, managerId: boss.id });
    await expect(change({ departmentId: d1.id, effectiveDate: "2026-01-05" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("dernière affectation") });
    await expect(st.changeAssignment(s.ctx, assignmentSchema.parse({ employeeId: boss.id, effectiveDate: "2026-03-03", jobTitle: "Comptable", managerId: e.id }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("boucle") });
    // le service est renommé : l'historique garde le nom d'époque
    await platformDb.department.update({ where: { id: d2.id }, data: { name: "Supply chain" } });
    const hist = await st.listAssignments(s.ctx, e.id);
    expect(hist.map((h) => h.departmentName)).toEqual(["Logistique", "Ventes"]);
    expect(hist[0]).toMatchObject({ managerName: "Yao Chef", reason: "Réorganisation" });
  });

  it("registre : une ligne par salarié avec dernier contrat ; filtres ; sortis inclus ; export sans salaire ; accès et isolation", async () => {
    const s = await setup();
    const a = await newEmp(s, { professionalCategory: "Employé" });
    const b = await newEmp(s, { firstName: "Moussa", lastName: "Traoré" });
    await emp.addContract(s.ctx, contractSchema.parse({ employeeId: a.id, type: "FIXED_TERM", startDate: "2026-01-05", endDate: "2026-12-31", salary: 350000 }));
    await emp.terminateEmployee(s.ctx, { id: b.id, endDate: "2026-06-30", reason: "Démission" });
    const all = await st.staffRegister(s.ctx, { skip: 0, take: 20 });
    expect(all.total).toBe(2);
    expect(all.rows.find((r) => r.id === a.id)).toMatchObject({ professionalCategory: "Employé", contract: { type: "FIXED_TERM" } });
    expect(all.rows.find((r) => r.id === b.id)).toMatchObject({ status: "TERMINATED", terminationReason: "Démission" });
    expect((await st.staffRegister(s.ctx, { status: "ACTIVE", skip: 0, take: 20 })).total).toBe(1);
    expect((await st.staffRegister(s.ctx, { q: "traor", skip: 0, take: 20 })).total).toBe(1);
    const table = await HR_EXPORTERS["hr-registre-personnel"]!.build(s.ctx, () => undefined);
    expect(table.rows).toHaveLength(2);
    expect(table.columns.map((c) => c.key)).not.toContain("salary");
    expect(JSON.stringify(table.rows)).not.toContain("350000");
    const m = await addMember(s.company.id, "employee");
    const self = await ctxFor(m.user.id, s.company.id);
    await expect(st.staffRegister(self, { skip: 0, take: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(st.listAssignments(self, a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(st.changeAssignment(self, assignmentSchema.parse({ employeeId: a.id, effectiveDate: "2026-03-02", jobTitle: "Autre" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await setup();
    expect((await st.staffRegister(other.ctx, { skip: 0, take: 5 })).total).toBe(0);
    await expect(st.listAssignments(other.ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
