import { describe, expect, it } from "vitest";
import { d } from "@/core/money";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as ab from "@/modules/hr/absences";
import * as adv from "@/modules/hr/advances";
import { advanceSchema, overtimeSchema } from "@/modules/hr/admin-schemas";
import * as emp from "@/modules/hr/employees";
import * as ot from "@/modules/hr/overtime";
import { advanceDue, hrPayrollPreview, payrollLinkSchema, savePayrollLink } from "@/modules/hr/payroll-link";
import { absenceSchema, timeOffSchema } from "@/modules/hr/registers-schemas";
import { employeeSchema } from "@/modules/hr/schemas";
import * as to from "@/modules/hr/timeoff";
import { runSchema } from "@/modules/payroll/schemas";
import * as pay from "@/modules/payroll/service";
import { addMember, ctxFor, makeCompany } from "../helpers";

// mars 2026 : 22 jours ouvrés ; salaire 440 000 → 20 000 par jour
async function setup() {
  const co = await makeCompany("PAIE RH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const e = await emp.createEmployee(ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 440000, jobTitle: "Comptable" }));
  return { ...co, ctx, e };
}
type S = Awaited<ReturnType<typeof setup>>;
const link = (over: Record<string, unknown> = {}) => payrollLinkSchema.parse({ ...over });
const run = (s: S, month = 3) => pay.createRun(s.ctx, runSchema.parse({ year: 2026, month }));
const slip = async (s: S, runId: string) => (await pay.getRun(s.ctx, runId)).payslips.find((p) => p.employeeId === s.e.id)!;
const day = (v: string) => new Date(`${v}T00:00:00.000Z`);

describe("liaison RH → paie : calculs purs", () => {
  const a = (over: Record<string, unknown> = {}) => ({ amount: d(300000), installments: 3, firstDeductionMonth: day("2026-03-01"), ...over });
  it("mensualités, rattrapage des mois manqués, solde à la dernière, jamais plus que le reste", () => {
    expect(advanceDue(a(), d(0), day("2026-02-01"), "XOF").toNumber()).toBe(0); // avant le premier mois
    expect(advanceDue(a(), d(0), day("2026-03-01"), "XOF").toNumber()).toBe(100000);
    expect(advanceDue(a(), d(100000), day("2026-04-01"), "XOF").toNumber()).toBe(100000);
    expect(advanceDue(a(), d(0), day("2026-04-01"), "XOF").toNumber()).toBe(200000); // mois manqué rattrapé
    expect(advanceDue(a(), d(200000), day("2026-05-01"), "XOF").toNumber()).toBe(100000);
    expect(advanceDue(a(), d(200000), day("2026-09-01"), "XOF").toNumber()).toBe(100000); // au-delà : solde
    expect(advanceDue(a(), d(300000), day("2026-05-01"), "XOF").toNumber()).toBe(0); // soldée
    expect(advanceDue(a({ amount: d(100), installments: 3 }), d(0), day("2026-05-01"), "XOF").toNumber()).toBe(100); // dernière mensualité = reste exact
  });
});

describe("liaison RH → paie", () => {
  it("désactivée par défaut : aucun élément RH n'entre dans la paie", async () => {
    const s = await setup();
    const t = await to.createTimeOffType(s.ctx, { name: "Non rémunérée", paid: false, requiresProof: false } as never);
    await to.createTimeOff(s.ctx, timeOffSchema.parse({ employeeId: s.e.id, typeId: t.id, unit: "DAILY", startDate: "2026-03-10", endDate: "2026-03-11", reason: "Convenance", submit: true }));
    const rate = await ot.createOvertimeRate(s.ctx, { name: "Taux", multiplier: 1.5 });
    await ot.createOvertime(s.ctx, overtimeSchema.parse({ employeeId: s.e.id, date: "2026-03-06", startTime: "18:00", endTime: "20:00", rateId: rate.id, reason: "Clôture", submit: true }));
    const r = await run(s);
    expect(Number((await slip(s, r.run.id)).gross)).toBe(440000);
    expect(await platformDb.payrollHrLink.count({ where: { runId: r.run.id } })).toBe(0);
    expect((await hrPayrollPreview(s.ctx, 2026, 3)).enabled).toBe(false);
  });

  it("permissions non rémunérées (jours et heures) et absences marquées « retenue » : déduites ; les autres absences et les arrêts maladie, jamais", async () => {
    const s = await setup();
    const t = await to.createTimeOffType(s.ctx, { name: "Non rémunérée", paid: false, requiresProof: false } as never);
    const paid = await to.createTimeOffType(s.ctx, { name: "Rémunérée", paid: true, requiresProof: false } as never);
    const off = (typeId: string, over: Record<string, unknown>) => to.createTimeOff(s.ctx, timeOffSchema.parse({ employeeId: s.e.id, typeId, unit: "DAILY", reason: "Test", submit: true, ...over }));
    await off(t.id, { startDate: "2026-03-10", endDate: "2026-03-11" }); // 2 j
    await off(t.id, { unit: "HOURLY", startDate: "2026-03-12", startTime: "09:00", endDate: "2026-03-12", endTime: "13:30" }); // 4,5 h = 0,5 j
    await off(paid.id, { startDate: "2026-03-13", endDate: "2026-03-13" }); // rémunérée : ignorée
    const ded = await ab.createAbsenceType(s.ctx, { name: "Retenue", category: "UNJUSTIFIED", requiresValidation: false, requiresProof: false, deductFromPay: true });
    const free = await ab.createAbsenceType(s.ctx, { name: "Sans retenue", category: "OTHER", requiresValidation: false, requiresProof: false });
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: s.e.id, typeId: ded.id, startDate: "2026-03-17", endDate: "2026-03-17" })); // 1 j
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: s.e.id, typeId: free.id, startDate: "2026-03-18", endDate: "2026-03-18" })); // ignorée
    const sick = await import("@/modules/hr/sickleave");
    await sick.createSickLeave(s.ctx, { employeeId: s.e.id, startDate: "2026-03-23", expectedEndDate: "2026-03-27", certificate: "ACCEPTED" } as never);

    await savePayrollLink(s.ctx, link({ payrollUnpaidTimeOff: true }));
    const r = await run(s);
    expect(Number((await slip(s, r.run.id)).unpaidDays)).toBe(2.5);
    expect(Number((await slip(s, r.run.id)).gross)).toBe(390000); // 440 000 × 19,5 / 22
    await savePayrollLink(s.ctx, link({ payrollUnpaidTimeOff: true, payrollUnpaidAbsences: true }));
    await pay.recalculateRun(s.ctx, r.run.id);
    expect(Number((await slip(s, r.run.id)).gross)).toBe(370000); // + 1 jour d'absence retenue : 18,5 j ; ni l'autre absence, ni l'arrêt maladie
    expect(Number((await slip(s, r.run.id)).unpaidDays)).toBe(3.5);
  });

  it("seule la paie peut marquer un motif d'absence « retenu sur salaire »", async () => {
    const s = await setup();
    const hr = await addMember(s.company.id, "hr");
    // le gabarit « RH » (hr.*) inclut la paie : on lui retire ce droit pour vérifier la règle
    await platformDb.rolePermission.deleteMany({ where: { roleId: hr.membership.roleId, permission: { key: "hr.payroll.manage" } } });
    const hrCtx = await ctxFor(hr.user.id, s.company.id);
    const base = { category: "UNJUSTIFIED" as const, requiresValidation: false, requiresProof: false };
    await ab.createAbsenceType(hrCtx, { ...base, name: "Sans retenue" });
    await expect(ab.createAbsenceType(hrCtx, { ...base, name: "Avec retenue", deductFromPay: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const t = await ab.createAbsenceType(s.ctx, { ...base, name: "Avec retenue", deductFromPay: true });
    await expect(ab.updateAbsenceType(hrCtx, { id: t.id, name: "Avec retenue", category: "UNJUSTIFIED", requiresValidation: false, requiresProof: false, deductFromPay: false, isActive: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("heures supplémentaires : payées au taux affecté (salaire ÷ heures de référence × coefficient), une seule fois, défaites à l'annulation", async () => {
    const s = await setup();
    await expect(savePayrollLink(s.ctx, link({ payrollOvertime: true }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("heures mensuelles") });
    await savePayrollLink(s.ctx, link({ payrollOvertime: true, payrollMonthlyHours: 200 }));
    const rate = await ot.createOvertimeRate(s.ctx, { name: "Taux", multiplier: 1.5 });
    const mk = (date: string, rateId?: string) => ot.createOvertime(s.ctx, overtimeSchema.parse({ employeeId: s.e.id, date, startTime: "18:00", endTime: "20:00", rateId, reason: "Clôture", submit: true }));
    const withRate = await mk("2026-03-06", rate.id);
    const noRate = await mk("2026-03-09"); // sans taux : non payées, avec avertissement
    expect(withRate.status).toBe("APPROVED");
    const pv = await hrPayrollPreview(s.ctx, 2026, 3);
    expect(pv.rows[0]!.vars.warnings.join(" ")).toContain("sans taux");
    const r = await run(s);
    expect(Number((await slip(s, r.run.id)).gross)).toBe(440000 + 6600); // 2 h × 2 200 × 1,5
    expect(await platformDb.payslipLine.count({ where: { payslipId: (await slip(s, r.run.id)).id, label: { contains: "Heures supplémentaires" } } })).toBe(1);
    expect((await platformDb.overtimeRecord.findFirstOrThrow({ where: { id: withRate.id } })).payrollPeriod).toBeNull(); // brouillon : rien n'est consommé

    await pay.validateRun(s.ctx, r.run.id);
    expect((await platformDb.overtimeRecord.findFirstOrThrow({ where: { id: withRate.id } })).payrollPeriod).toBe("2026-03");
    expect((await platformDb.overtimeRecord.findFirstOrThrow({ where: { id: noRate.id } })).payrollPeriod).toBeNull();
    // le mois suivant : les heures déjà payées ne le sont pas deux fois
    const april = await run(s, 4);
    expect(Number((await slip(s, april.run.id)).gross)).toBe(440000);
    await pay.cancelRun(s.ctx, april.run.id);

    await pay.cancelRun(s.ctx, r.run.id); // campagne validée annulée : les heures redeviennent payables
    expect((await platformDb.overtimeRecord.findFirstOrThrow({ where: { id: withRate.id } })).payrollPeriod).toBeNull();
    const again = await run(s);
    expect(Number((await slip(s, again.run.id)).gross)).toBe(446600);
  });

  it("avances : retenue mensuelle, remboursement de paie unique par période, rattrapage, annulation qui défait, campagne payée non annulable", async () => {
    const s = await setup();
    await savePayrollLink(s.ctx, link({ payrollAdvances: true }));
    const a = await adv.createAdvance(s.ctx, advanceSchema.parse({ employeeId: s.e.id, kind: "ADVANCE", amount: 300000, requestDate: "2026-02-20", installments: 3, firstDeductionMonth: "2026-03-01", reason: "Test", submit: true }));
    expect(a.status).toBe("APPROVED");
    const r = await run(s);
    const sl = await slip(s, r.run.id);
    expect(Number(sl.gross)).toBe(440000);
    expect(Number(sl.netPay)).toBe(340000); // 440 000 − 100 000
    expect(await platformDb.advanceRepayment.count({ where: { advanceId: a.id } })).toBe(0); // brouillon : rien d'enregistré
    await pay.validateRun(s.ctx, r.run.id);
    const reps = await platformDb.advanceRepayment.findMany({ where: { advanceId: a.id } });
    expect(reps).toHaveLength(1);
    expect(reps[0]).toMatchObject({ source: "PAYROLL", period: "2026-03" });
    expect((await adv.getAdvance(s.ctx, a.id)).balance.toNumber()).toBe(200000);
    await expect(platformDb.advanceRepayment.create({ data: { companyId: s.company.id, advanceId: a.id, date: day("2026-03-31"), amount: "100000", source: "PAYROLL", period: "2026-03" } })).rejects.toBeTruthy();

    // annulation de la campagne validée : la retenue disparaît ; la recréer ne double pas la déduction
    await pay.cancelRun(s.ctx, r.run.id);
    expect(await platformDb.advanceRepayment.count({ where: { advanceId: a.id } })).toBe(0);
    const r2 = await run(s);
    expect(Number((await slip(s, r2.run.id)).netPay)).toBe(340000);
    await pay.validateRun(s.ctx, r2.run.id);
    expect(await platformDb.advanceRepayment.count({ where: { advanceId: a.id } })).toBe(1);
    // avril : deuxième mensualité
    const apr = await run(s, 4);
    expect(Number((await slip(s, apr.run.id)).netPay)).toBe(340000);
    // un remboursement manuel entre le calcul et la validation fait échouer la validation (jamais plus que le reste)
    await adv.recordRepayment(s.ctx, { advanceId: a.id, date: "2026-04-02", amount: 150000 } as never);
    await expect(pay.validateRun(s.ctx, apr.run.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("recalculez") });
    await pay.recalculateRun(s.ctx, apr.run.id);
    expect(Number((await slip(s, apr.run.id)).netPay)).toBe(440000); // l'avance remboursée d'avance couvre la mensualité d'avril : rien à retenir
    await pay.validateRun(s.ctx, apr.run.id);
    const may = await run(s, 5);
    expect(Number((await slip(s, may.run.id)).netPay)).toBe(440000 - 50000); // reste 50 000 : la dernière mensualité solde
    await pay.validateRun(s.ctx, may.run.id);
    expect((await adv.getAdvance(s.ctx, a.id)).balance.toNumber()).toBe(0);
  });

  it("réglages réservés au droit « gérer la paie » (action serveur) ; isolation entre entreprises", async () => {
    const s = await setup();
    const m = await addMember(s.company.id, "employee");
    const self = await ctxFor(m.user.id, s.company.id);
    expect(self.can("hr.payroll.manage")).toBe(false);
    const other = await setup();
    await savePayrollLink(s.ctx, link({ payrollUnpaidTimeOff: true }));
    expect((await hrPayrollPreview(other.ctx, 2026, 3)).policy.unpaidTimeOff).toBe(false);
    expect((await hrPayrollPreview(s.ctx, 2026, 3)).policy.unpaidTimeOff).toBe(true);
  });
});
