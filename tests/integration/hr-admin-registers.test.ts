import { describe, expect, it } from "vitest";
import { decideApproval, listApprovals } from "@/core/approvals";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as ab from "@/modules/hr/absences";
import * as adv from "@/modules/hr/advances";
import { advanceSchema, closeCaseSchema, completeVisitSchema, decideCaseSchema, disciplinaryCaseSchema, equipmentSchema, medicalVisitSchema, notifyCaseSchema, overtimeSchema, repaymentSchema, returnEquipmentSchema, sanctionTypeSchema, stepSchema } from "@/modules/hr/admin-schemas";
import * as emp from "@/modules/hr/employees";
import * as eq from "@/modules/hr/equipment";
import { HR_EXPORTERS } from "@/modules/hr/exports";
import * as la from "@/modules/hr/lateness";
import * as mv from "@/modules/hr/medvisits";
import * as ot from "@/modules/hr/overtime";
import { absenceSchema, latenessSchema } from "@/modules/hr/registers-schemas";
import * as sa from "@/modules/hr/sanctions";
import { employeeSchema } from "@/modules/hr/schemas";
import { productSchema } from "@/modules/inventory/schemas";
import * as inv from "@/modules/inventory/service";
import { addMember, ctxFor, makeCompany } from "../helpers";

async function setup() {
  const co = await makeCompany("ADMIN RH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  return { ...co, ctx };
}
type S = Awaited<ReturnType<typeof setup>>;
const newEmp = (s: S, over: Record<string, unknown> = {}) => emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000, jobTitle: "Comptable", ...over }));
async function selfService(s: S, over: Record<string, unknown> = {}) {
  const m = await addMember(s.company.id, "employee");
  const e = await newEmp(s, { userId: m.user.id, ...over });
  return { m, e, ctx: await ctxFor(m.user.id, s.company.id) };
}
const day = (v: string) => new Date(`${v}T00:00:00.000Z`);

describe("heures supplémentaires", () => {
  const input = (employeeId: string, over: Record<string, unknown> = {}) => overtimeSchema.parse({ employeeId, date: "2026-03-02", startTime: "18:00", endTime: "20:30", reason: "Clôture mensuelle", ...over });

  it("durée calculée ; taux paramétrables (jamais codés) ; plage dans l'horaire normal refusée ; week-end entièrement supplémentaire", async () => {
    const s = await setup();
    const e = await newEmp(s);
    expect(await ot.listOvertimeRates(s.ctx)).toEqual([]); // aucun taux préchargé
    const rate = await ot.createOvertimeRate(s.ctx, { name: "Taux de l'entreprise", multiplier: 1.25 });
    await expect(ot.createOvertimeRate(s.ctx, { name: "taux de l'entreprise", multiplier: 1.5 })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const r = await ot.createOvertime(s.ctx, input(e.id, { rateId: rate.id }));
    expect(r).toMatchObject({ status: "DRAFT", rateId: rate.id });
    expect([Number(r.hours), Number(r.normalHours)]).toEqual([2.5, 9]);
    await expect(ot.createOvertime(s.ctx, input(e.id, { date: "2026-03-03", startTime: "16:00", endTime: "19:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("empiète") });
    const we = await ot.createOvertime(s.ctx, input(e.id, { date: "2026-03-07", startTime: "09:00", endTime: "13:00" })); // samedi
    expect([Number(we.hours), Number(we.normalHours)]).toEqual([4, 0]);
    await expect(ot.createOvertime(s.ctx, input(e.id, { date: "2026-03-04", startTime: "20:00", endTime: "19:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(ot.createOvertime(s.ctx, input(e.id, { date: "2999-01-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("à l'avance") });
    await ot.updateOvertimeRate(s.ctx, { id: rate.id, name: "Taux de l'entreprise", multiplier: 1.3, isActive: true });
    expect(Number((await ot.listOvertimeRates(s.ctx))[0]!.multiplier)).toBe(1.3);
  });

  it("validation hiérarchique : soumission, décision par un tiers, heures approuvées ; refus ; modification après validation refusée ; chevauchement", async () => {
    const s = await setup();
    const { e, ctx } = await selfService(s);
    const first = await ot.createOvertime(ctx, input(e.id));
    await expect(ot.createOvertime(ctx, input(e.id, { startTime: "19:00", endTime: "21:00" }))).resolves.toBeTruthy(); // brouillon : ne bloque pas
    const sub = await ot.submitOvertime(ctx, first.id);
    expect(sub.status).toBe("PENDING");
    await expect(ot.createOvertime(ctx, input(e.id, { startTime: "19:00", endTime: "21:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche d'autres heures") });
    const appr = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows.find((a) => a.resourceType === "overtime")!;
    await expect(decideApproval(ctx, { id: appr.id, decision: "APPROVED" })).rejects.toBeTruthy();
    await decideApproval(s.ctx, { id: appr.id, decision: "APPROVED", comment: "Ok" });
    const done = await ot.getOvertime(ctx, first.id);
    expect(done).toMatchObject({ status: "APPROVED", decidedById: s.owner.id });
    expect(Number(done.approvedHours)).toBe(2.5);
    const { updateOvertimeSchema } = await import("@/modules/hr/admin-schemas");
    await expect(ot.updateOvertime(ctx, updateOvertimeSchema.parse({ id: first.id, date: "2026-03-02", startTime: "18:00", endTime: "19:00", reason: "Autre" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("validées") });
    await expect(ot.cancelOvertime(ctx, first.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("seule la RH") });
    await ot.cancelOvertime(s.ctx, first.id);
    expect((await ot.getOvertime(s.ctx, first.id)).approvedHours).toBeNull();

    const second = await ot.createOvertime(ctx, input(e.id, { date: "2026-03-09", submit: true }));
    expect(second.status).toBe("PENDING");
    const appr2 = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows.find((a) => a.resourceId === second.id)!;
    await decideApproval(s.ctx, { id: appr2.id, decision: "REJECTED", comment: "Non planifié" });
    expect(await ot.getOvertime(ctx, second.id)).toMatchObject({ status: "REJECTED", approvedHours: null });
  });

  it("un jour d'absence : pas d'heures supplémentaires ; équipe, accès et isolation ; export", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const at = await ab.createAbsenceType(s.ctx, { name: "Autre", category: "OTHER", requiresValidation: false, requiresProof: false });
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: e.id, typeId: at.id, startDate: "2026-03-10", endDate: "2026-03-10" }));
    await expect(ot.createOvertime(s.ctx, input(e.id, { date: "2026-03-10" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche une absence") });
    await ot.createOvertime(s.ctx, input(e.id, { date: "2026-03-11", startTime: "19:00", endTime: "20:00" })); // jour sans congé ni absence : accepté

    const a = await selfService(s, { firstName: "Alice" });
    const b = await selfService(s, { firstName: "Boris", lastName: "Yao" });
    await expect(ot.createOvertime(a.ctx, input(b.e.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const mine = await ot.createOvertime(a.ctx, input(a.e.id));
    await ot.createOvertime(b.ctx, input(b.e.id));
    expect((await ot.listOvertime(a.ctx, { skip: 0, take: 20 })).rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(ot.getOvertime(b.ctx, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // le responsable ne valide que son équipe
    const mgr = await addMember(s.company.id, "employee");
    const mgrEmp = await newEmp(s, { userId: mgr.user.id, firstName: "Chef" });
    await platformDb.employee.update({ where: { id: a.e.id }, data: { managerId: mgrEmp.id } });
    const perm = await platformDb.permission.findMany({ where: { key: { in: ["hr.overtime.approve", "workflow.request.approve"] } } });
    await platformDb.rolePermission.createMany({ data: perm.map((p) => ({ roleId: mgr.membership.roleId, permissionId: p.id, companyId: s.company.id })), skipDuplicates: true });
    const mctx = await ctxFor(mgr.user.id, s.company.id);
    await ot.submitOvertime(a.ctx, mine.id);
    const bRow = (await ot.listOvertime(b.ctx, { skip: 0, take: 5 })).rows[0]!;
    await ot.submitOvertime(b.ctx, bRow.id);
    const pend = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 20 })).rows.filter((r) => r.resourceType === "overtime");
    await expect(decideApproval(mctx, { id: pend.find((r) => r.resourceId === bRow.id)!.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("hors de votre équipe") });
    await decideApproval(mctx, { id: pend.find((r) => r.resourceId === mine.id)!.id, decision: "APPROVED" });
    const other = await setup();
    await expect(ot.getOvertime(other.ctx, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const table = await HR_EXPORTERS["hr-heures-supplementaires"]!.build(s.ctx, () => undefined);
    expect(table.rows).toHaveLength(3);
  });

});

describe("avances et acomptes", () => {
  const input = (employeeId: string, over: Record<string, unknown> = {}) => advanceSchema.parse({ employeeId, kind: "ADVANCE", amount: 150000, requestDate: "2026-03-02", installments: 3, firstDeductionMonth: "2026-04-15", reason: "Rentrée scolaire", ...over });

  it("demande → validation par un tiers → remboursements ; reste calculé ; dépassement refusé ; annulation impossible après remboursement", async () => {
    const s = await setup();
    const { e, ctx } = await selfService(s);
    const a = await adv.createAdvance(ctx, input(e.id, { submit: true }));
    expect(a.status).toBe("PENDING");
    const appr = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows.find((r) => r.resourceType === "advance")!;
    expect(Number(appr.amount)).toBe(150000);
    await decideApproval(s.ctx, { id: appr.id, decision: "APPROVED" });
    const ok = await adv.getAdvance(ctx, a.id);
    expect(ok.status).toBe("APPROVED");
    expect(ok.firstDeductionMonth.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(ok.balance.toNumber()).toBe(150000);
    await expect(adv.recordRepayment(ctx, repaymentSchema.parse({ advanceId: a.id, date: "2026-04-30", amount: 1000 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await adv.recordRepayment(s.ctx, repaymentSchema.parse({ advanceId: a.id, date: "2026-04-30", amount: 50000 }));
    await expect(adv.recordRepayment(s.ctx, repaymentSchema.parse({ advanceId: a.id, date: "2026-05-31", amount: 100001 }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("dépasse") });
    await expect(adv.recordRepayment(s.ctx, repaymentSchema.parse({ advanceId: a.id, date: "2026-02-01", amount: 100 }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await adv.recordRepayment(s.ctx, repaymentSchema.parse({ advanceId: a.id, date: "2026-05-31", amount: 100000 }));
    expect((await adv.getAdvance(s.ctx, a.id)).balance.toNumber()).toBe(0);
    expect(await adv.outstandingAdvances(s.ctx)).toEqual([]);
    await expect(adv.cancelAdvance(s.ctx, a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("remboursements") });
    await expect(adv.recordRepayment(s.ctx, repaymentSchema.parse({ advanceId: a.id, date: "2026-06-01", amount: 1 }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("dépasse") });
  });

  it("pas de double déduction : une retenue de paie par avance et par période (contrainte en base)", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await adv.createAdvance(s.ctx, input(e.id, { submit: true })); // d'office : administrateur unique
    expect(a.status).toBe("APPROVED");
    const row = { companyId: s.company.id, advanceId: a.id, date: day("2026-04-30"), amount: "50000", source: "PAYROLL" as const, period: "2026-04" };
    await platformDb.advanceRepayment.create({ data: row });
    await expect(platformDb.advanceRepayment.create({ data: row })).rejects.toBeTruthy();
    expect((await adv.getAdvance(s.ctx, a.id)).balance.toNumber()).toBe(100000);
  });

  it("validations, brouillon modifiable puis figé ; accès : un salarié ne voit que les siennes ; isolation ; export", async () => {
    const s = await setup();
    const a = await selfService(s, { firstName: "Alice" });
    const b = await selfService(s, { firstName: "Boris", lastName: "Yao" });
    await expect(adv.createAdvance(a.ctx, input(b.e.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adv.createAdvance(a.ctx, input(a.e.id, { requestDate: "2999-01-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("futur") });
    await expect(adv.createAdvance(a.ctx, input(a.e.id, { firstDeductionMonth: "2026-02-10" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("précéder") });
    expect(() => advanceSchema.parse({ ...input(a.e.id), amount: 0 })).toThrow();
    expect(() => advanceSchema.parse({ ...input(a.e.id), installments: 0 })).toThrow();
    const mine = await adv.createAdvance(a.ctx, input(a.e.id));
    const { updateAdvanceSchema } = await import("@/modules/hr/admin-schemas");
    await adv.updateAdvance(a.ctx, updateAdvanceSchema.parse({ id: mine.id, kind: "ACOMPTE", amount: 80000, requestDate: "2026-03-02", installments: 2, firstDeductionMonth: "2026-04-01" }));
    expect(Number((await adv.getAdvance(a.ctx, mine.id)).amount)).toBe(80000);
    await adv.submitAdvance(a.ctx, mine.id);
    await expect(adv.updateAdvance(a.ctx, updateAdvanceSchema.parse({ id: mine.id, kind: "ACOMPTE", amount: 90000, requestDate: "2026-03-02", installments: 2, firstDeductionMonth: "2026-04-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await adv.createAdvance(b.ctx, input(b.e.id));
    expect((await adv.listAdvances(a.ctx, { skip: 0, take: 20 })).rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(adv.getAdvance(b.ctx, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await setup();
    await expect(adv.getAdvance(other.ctx, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await HR_EXPORTERS["hr-avances"]!.build(s.ctx, () => undefined)).rows).toHaveLength(2);
  });
});

describe("sanctions disciplinaires", () => {
  const open = (s: S, employeeId: string, over: Record<string, unknown> = {}) => sa.createCase(s.ctx, disciplinaryCaseSchema.parse({ employeeId, factsDate: "2026-03-02", description: "Abandon de poste constaté par le responsable.", breachNature: "Absence non autorisée", ...over }));

  it("types configurables ; numéro de dossier ; procédure : audition exigée avant décision, notification ensuite, étapes réservées", async () => {
    const s = await setup();
    const e = await newEmp(s);
    expect(await sa.listSanctionTypes(s.ctx)).toEqual([]); // rien de prédéfini
    const strict = await sa.createSanctionType(s.ctx, sanctionTypeSchema.parse({ name: "Mesure A", requiresHearing: true }));
    const light = await sa.createSanctionType(s.ctx, sanctionTypeSchema.parse({ name: "Mesure B", requiresHearing: false }));
    await expect(sa.createSanctionType(s.ctx, sanctionTypeSchema.parse({ name: "mesure a" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const c = await open(s, e.id);
    expect(c.number).toMatch(/^DIS-\d{4}-\d{4}$/);
    expect(c).toMatchObject({ status: "OPEN", employeeName: "Koné Awa" });
    await expect(sa.addStep(s.ctx, stepSchema.parse({ caseId: c.id, kind: "DECISION", date: "2026-03-05" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("dédiées") });
    await expect(sa.addStep(s.ctx, stepSchema.parse({ caseId: c.id, kind: "CONVOCATION", date: "2026-03-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("précède") });
    await sa.addStep(s.ctx, stepSchema.parse({ caseId: c.id, kind: "CONVOCATION", date: "2026-03-04" }));
    const decide = (typeId: string, date: string) => sa.decideCase(s.ctx, decideCaseSchema.parse({ id: c.id, sanctionTypeId: typeId, decisionDate: date }));
    await expect(decide(strict.id, "2026-03-10")).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("audition préalable") });
    await sa.addStep(s.ctx, stepSchema.parse({ caseId: c.id, kind: "HEARING", date: "2026-03-09" }));
    await expect(decide(strict.id, "2026-03-08")).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("audition préalable") }); // audition postérieure
    await decide(strict.id, "2026-03-10");
    expect(await sa.getCase(s.ctx, c.id)).toMatchObject({ status: "DECIDED", sanctionType: { name: "Mesure A" } });
    await expect(sa.updateCase(s.ctx, { id: c.id, factsDate: "2026-03-02", description: "Faits modifiés ici", breachNature: "x1" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("décidée") });
    await expect(sa.notifyCase(s.ctx, notifyCaseSchema.parse({ id: c.id, notificationDate: "2026-03-09" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("précède la décision") });
    await sa.notifyCase(s.ctx, notifyCaseSchema.parse({ id: c.id, notificationDate: "2026-03-11" }));
    const done = await sa.getCase(s.ctx, c.id);
    expect(done.status).toBe("NOTIFIED");
    expect(done.steps.map((x) => x.kind)).toEqual(["CONVOCATION", "HEARING", "DECISION", "NOTIFICATION"]);
    await expect(sa.cancelCase(s.ctx, closeCaseSchema.parse({ id: c.id, note: "erreur" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("notifiée") });
    // type sans audition exigée : décision directe ; classement sans suite avec motif
    const c2 = await open(s, e.id, { factsDate: "2026-03-03" });
    await sa.decideCase(s.ctx, decideCaseSchema.parse({ id: c2.id, sanctionTypeId: light.id, decisionDate: "2026-03-12" }));
    const c3 = await open(s, e.id, { factsDate: "2026-03-04" });
    await expect(sa.closeCase(s.ctx, closeCaseSchema.parse({ id: c3.id }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("motif") });
    await sa.closeCase(s.ctx, closeCaseSchema.parse({ id: c3.id, note: "Faits non établis" }));
    expect((await sa.getCase(s.ctx, c3.id)).status).toBe("CLOSED");
    expect((await sa.getCase(s.ctx, c.id)).history.length).toBeGreaterThan(3);
  });

  it("jamais de sanction automatique : retards, absences répétées et arrêts ne créent aucun dossier", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const at = await ab.createAbsenceType(s.ctx, { name: "Injustifiée", category: "UNJUSTIFIED", requiresValidation: false, requiresProof: false });
    for (const d of ["2026-06-01", "2026-06-08", "2026-06-15"]) {
      await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: e.id, typeId: at.id, startDate: d, endDate: d }));
      await la.createLateness(s.ctx, latenessSchema.parse({ employeeId: e.id, date: `${d.slice(0, 8)}${String(Number(d.slice(8)) + 1).padStart(2, "0")}`, actualTime: "09:30" }));
    }
    expect((await ab.repeatedAbsences(s.ctx, new Date("2026-06-30T10:00:00Z"))).length).toBe(1);
    expect((await la.recurringLateness(s.ctx, new Date("2026-06-30T10:00:00Z"))).length).toBe(1);
    expect(await platformDb.disciplinaryCase.count({ where: { companyId: s.company.id } })).toBe(0);
  });

  it("accès réservé aux profils « sanctions » (ni le salarié, ni un responsable) ; consultation tracée ; isolation ; aucune suppression", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const c = await open(s, e.id);
    const self = await selfService(s);
    await expect(sa.listCases(self.ctx, { skip: 0, take: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sa.getCase(self.ctx, c.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sa.createCase(self.ctx, disciplinaryCaseSchema.parse({ employeeId: self.e.id, factsDate: "2026-03-02", description: "Description des faits", breachNature: "Autre" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const viewer = await addMember(s.company.id, "viewer"); // *.read : consultation seule
    const vctx = await ctxFor(viewer.user.id, s.company.id);
    expect((await sa.listCases(vctx, { skip: 0, take: 5 })).total).toBe(1);
    await expect(sa.addStep(vctx, stepSchema.parse({ caseId: c.id, kind: "OTHER", date: "2026-03-05" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await sa.logCaseView(s.ctx, c);
    expect(await platformDb.auditLog.count({ where: { companyId: s.company.id, action: "hr.sanction.view" } })).toBe(1);
    const other = await setup();
    await expect(sa.getCase(other.ctx, c.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(Object.keys(sa)).not.toContain("deleteCase");
  });
});

describe("visites médicales", () => {
  it("programmation, réalisation, prochaine échéance, document d'aptitude (statut seul), doublon refusé ; aucun champ de résultat médical", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const sch = (over: Record<string, unknown> = {}) => medicalVisitSchema.parse({ employeeId: e.id, kind: "PERIODIC", scheduledOn: "2026-12-10", provider: "Service de santé au travail", ...over });
    const v = await mv.createVisit(s.ctx, sch());
    await expect(mv.createVisit(s.ctx, sch())).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("déjà programmée") });
    await expect(mv.completeVisit(s.ctx, completeVisitSchema.parse({ id: v.id, doneOn: "2999-01-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("futur") });
    await expect(mv.completeVisit(s.ctx, completeVisitSchema.parse({ id: v.id, doneOn: "2026-03-02", nextDueOn: "2026-03-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("suivre") });
    await mv.completeVisit(s.ctx, completeVisitSchema.parse({ id: v.id, doneOn: "2026-03-02", nextDueOn: "2027-03-02" }));
    expect(await platformDb.medicalVisit.findFirstOrThrow({ where: { id: v.id } })).toMatchObject({ status: "DONE", aptitudeDoc: "PENDING" });
    await mv.setAptitudeDoc(s.ctx, { id: v.id, aptitudeDoc: "PROVIDED" });
    await expect(mv.updateVisit(s.ctx, { id: v.id, kind: "PERIODIC", scheduledOn: "2026-12-11" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("réalisée") });
    const cols = (await platformDb.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'MedicalVisit'`).map((c) => c.column_name);
    expect(cols.filter((c) => /result|outcome|aptitude(?!Doc)|diagnos|conclusion|restriction/i.test(c))).toEqual([]);
  });

  it("rappels : visite en retard, proche, et salarié « à programmer » (échéance proche sans visite programmée) ; seuil paramétrable", async () => {
    const s = await setup();
    const a = await newEmp(s), b = await newEmp(s, { firstName: "Moussa", lastName: "Traoré" }), c = await newEmp(s, { firstName: "Yao", lastName: "Kouadio" });
    const today = new Date("2026-11-19T10:00:00Z");
    const plan = (employeeId: string, scheduledOn: string) => mv.createVisit(s.ctx, medicalVisitSchema.parse({ employeeId, kind: "PERIODIC", scheduledOn }));
    await plan(a.id, "2026-11-01"); // en retard
    await plan(b.id, "2026-12-01"); // proche (≤ 30 j)
    const done = await plan(c.id, "2026-01-05");
    await mv.completeVisit(s.ctx, completeVisitSchema.parse({ id: done.id, doneOn: "2026-01-05", nextDueOn: "2026-12-05" }));
    const al = await mv.visitAlerts(s.ctx, today);
    expect(al.overdue.map((v) => v.employeeId)).toEqual([a.id]);
    expect(al.soon.map((v) => v.employeeId)).toEqual([b.id]);
    expect(al.toSchedule.map((v) => v.employeeId)).toEqual([c.id]);
    await plan(c.id, "2026-12-03"); // programmée : n'est plus « à programmer »
    expect((await mv.visitAlerts(s.ctx, today)).toSchedule).toEqual([]);
    expect(mv.visitState({ status: "PLANNED", scheduledOn: day("2026-12-30") }, today, 30)).toBeNull();
    expect(mv.visitState({ status: "PLANNED", scheduledOn: day("2026-12-30") }, today, 60)).toBe("soon");
    expect(mv.visitState({ status: "DONE", scheduledOn: day("2026-01-01") }, today, 30)).toBeNull();
  });

  it("accès réservé aux profils « visites médicales » ; isolation ; export", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const v = await mv.createVisit(s.ctx, medicalVisitSchema.parse({ employeeId: e.id, kind: "HIRING", scheduledOn: "2026-12-10" }));
    const self = await selfService(s);
    await expect(mv.listVisits(self.ctx, { skip: 0, take: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mv.createVisit(self.ctx, medicalVisitSchema.parse({ employeeId: self.e.id, kind: "HIRING", scheduledOn: "2026-12-10" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mv.cancelVisit((await setup()).ctx, v.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await HR_EXPORTERS["hr-visites-medicales"]!.build(s.ctx, () => undefined)).rows).toHaveLength(1);
  });
});

describe("équipements et EPI", () => {
  const input = (employeeId: string, over: Record<string, unknown> = {}) => equipmentSchema.parse({ employeeId, name: "Casque de chantier", reference: "CAS-01", quantity: 2, issuedOn: "2026-03-02", condition: "NEW", replaceOn: "2027-03-02", ...over });

  it("remise, restitution, historique, alertes de remplacement et de non-restitution", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await eq.issueEquipment(s.ctx, input(e.id));
    expect(a).toMatchObject({ quantity: 2, responsibleName: "Test User" });
    await expect(eq.issueEquipment(s.ctx, input(e.id, { replaceOn: "2026-03-02" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("après la remise") });
    await expect(eq.issueEquipment(s.ctx, input(e.id, { issuedOn: "2999-01-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("futur") });
    await expect(eq.issueEquipment(s.ctx, input(e.id, { productId: "11111111-1111-4111-8111-111111111111" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("produit ET") });
    expect(eq.equipmentAlert({ returnedOn: null, replaceOn: day("2026-12-01") }, "ACTIVE", new Date("2026-11-19T10:00:00Z"), 30)).toBe("replace_soon");
    expect(eq.equipmentAlert({ returnedOn: null, replaceOn: day("2026-11-01") }, "ACTIVE", new Date("2026-11-19T10:00:00Z"), 30)).toBe("replace_overdue");
    expect(eq.equipmentAlert({ returnedOn: null, replaceOn: day("2027-06-01") }, "ACTIVE", new Date("2026-11-19T10:00:00Z"), 30)).toBeNull();
    expect(eq.equipmentAlert({ returnedOn: day("2026-11-01"), replaceOn: day("2026-11-01") }, "ACTIVE", new Date("2026-11-19T10:00:00Z"), 30)).toBeNull();
    await expect(eq.returnEquipment(s.ctx, returnEquipmentSchema.parse({ id: a.id, returnedOn: "2026-02-01", returnCondition: "GOOD" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("précède la remise") });
    await expect(eq.returnEquipment(s.ctx, returnEquipmentSchema.parse({ id: a.id, returnedOn: "2026-06-01", returnCondition: "GOOD", backToStock: true }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("pas été sorti du stock") });
    await eq.returnEquipment(s.ctx, returnEquipmentSchema.parse({ id: a.id, returnedOn: "2026-06-01", returnCondition: "WORN" }));
    await expect(eq.returnEquipment(s.ctx, returnEquipmentSchema.parse({ id: a.id, returnedOn: "2026-06-02", returnCondition: "WORN" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("déjà restitué") });
    const b = await eq.issueEquipment(s.ctx, input(e.id, { name: "Gilet", replaceOn: undefined }));
    await emp.terminateEmployee(s.ctx, { id: e.id, endDate: "2026-09-30", reason: "Démission" });
    expect((await eq.equipmentAlerts(s.ctx)).map((x) => [x.id, x.alert])).toEqual([[b.id, "not_returned"]]); // l'équipement non rendu d'un salarié sorti
    expect((await eq.listEquipment(s.ctx, { status: "RETURNED", skip: 0, take: 10 })).total).toBe(1);
  });

  it("liaison au stock : sortie à la remise, retour en stock à la restitution ; stock insuffisant → rien n'est enregistré", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const wh = await platformDb.warehouse.findFirst({ where: { companyId: s.company.id } }) ?? await platformDb.warehouse.create({ data: { companyId: s.company.id, name: "Magasin", code: "MAG", isDefault: true } });
    const p = await inv.createProduct(s.ctx, productSchema.parse({ name: "Casque", type: "GOODS", unit: "pièce", salePrice: 5000, costPrice: 3000, trackStock: true, minStock: 0, openingWarehouseId: wh.id, openingQuantity: 5 }));
    const qty = async () => Number((await s.ctx.db.stockLevel.aggregate({ where: { productId: p.id }, _sum: { quantity: true } }))._sum.quantity ?? 0);
    expect(await qty()).toBe(5);
    const a = await eq.issueEquipment(s.ctx, input(e.id, { quantity: 2, productId: p.id, warehouseId: wh.id }));
    expect(a.issueMovementId).toBeTruthy();
    expect(await qty()).toBe(3);
    await expect(eq.issueEquipment(s.ctx, input(e.id, { name: "Casque bis", quantity: 4, productId: p.id, warehouseId: wh.id }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Stock insuffisant") });
    expect(await platformDb.equipmentAssignment.count({ where: { employeeId: e.id } })).toBe(1); // atomique : pas d'attribution orpheline
    expect(await qty()).toBe(3);
    await eq.returnEquipment(s.ctx, returnEquipmentSchema.parse({ id: a.id, returnedOn: "2026-06-01", returnCondition: "GOOD", backToStock: true }));
    expect(await qty()).toBe(5);
    expect((await eq.getEquipment(s.ctx, a.id)).returnMovementId).toBeTruthy();
  });

  it("accès réservé aux profils « équipements » ; isolation ; export", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await eq.issueEquipment(s.ctx, input(e.id));
    const self = await selfService(s);
    await expect(eq.listEquipment(self.ctx, { skip: 0, take: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(eq.issueEquipment(self.ctx, input(self.e.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(eq.getEquipment((await setup()).ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await HR_EXPORTERS["hr-equipements"]!.build(s.ctx, () => undefined)).rows).toHaveLength(1);
  });
});
