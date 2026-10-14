import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { addHoliday, generateHolidays, generateHolidaysSchema, holidaySchema, listHolidays, setWorkDays, workDaysSchema, deleteHoliday } from "@/modules/hr/calendar";
import * as emp from "@/modules/hr/employees";
import * as lv from "@/modules/hr/leave";
import { employeeSchema, leaveTypeSchema } from "@/modules/hr/schemas";
import { runSchema } from "@/modules/payroll/schemas";
import * as pay from "@/modules/payroll/service";
import { ctxFor, makeCompany } from "../helpers";

async function setup() {
  const co = await makeCompany("CALENDRIER", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const newEmp = (over: Record<string, unknown> = {}) => emp.createEmployee(ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2018-01-08", baseSalary: 440000, jobTitle: "Comptable", ...over }));
  const type = (over: Record<string, unknown>) => lv.createLeaveType(ctx, leaveTypeSchema.parse({ name: `Type ${Math.random().toString(36).slice(2, 8)}`, annualDays: 22, paid: true, ...over }));
  const holiday = (date: string, name = "Férié") => addHoliday(ctx, holidaySchema.parse({ date, name }));
  const ask = (employeeId: string, typeId: string, startDate: string, endDate: string) => lv.requestLeave(ctx, { employeeId, typeId, startDate, endDate, reason: "" });
  return { ...co, ctx, newEmp, type, holiday, ask };
}

describe("jours fériés et semaine travaillée : congés", () => {
  it("un jour férié dans la période n'est pas décompté du congé", async () => {
    const s = await setup();
    const e = await s.newEmp();
    const t = await s.type({});
    await s.holiday("2027-03-03", "Fête locale"); // mercredi
    const r = await s.ask(e.id, t.id, "2027-03-01", "2027-03-05");
    expect(Number(r.days)).toBe(4);
    const b = (await lv.leaveBalances(s.ctx, e.id, 2027)).find((x) => x.type.id === t.id)!;
    expect(b.taken.toNumber() + b.pending.toNumber()).toBe(4);
  });

  it("une période réduite à des jours fériés et des week-ends est refusée", async () => {
    const s = await setup();
    const e = await s.newEmp();
    const t = await s.type({});
    await s.holiday("2027-03-08", "Férié lundi");
    await expect(s.ask(e.id, t.id, "2027-03-06", "2027-03-08")).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("aucun jour travaillé") });
  });

  it("une semaine du lundi au samedi : le samedi compte", async () => {
    const s = await setup();
    const e = await s.newEmp();
    const t = await s.type({});
    expect(Number((await s.ask(e.id, t.id, "2027-03-01", "2027-03-06")).days)).toBe(5); // samedi non travaillé par défaut
    await setWorkDays(s.ctx, workDaysSchema.parse({ workDays: [1, 2, 3, 4, 5, 6] }));
    expect(Number((await s.ask(e.id, t.id, "2027-04-05", "2027-04-10")).days)).toBe(6);
    expect(() => workDaysSchema.parse({ workDays: [] })).toThrow();
  });

  it("gestion des jours fériés : doublon refusé, génération sans écraser, suppression, isolation entre entreprises", async () => {
    const s = await setup();
    const other = await setup();
    await s.holiday("2026-05-14", "Jeudi de l'Ascension (nom personnalisé)");
    await expect(s.holiday("2026-05-14", "Doublon")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const r = await generateHolidays(s.ctx, generateHolidaysSchema.parse({ country: "CI", year: 2026 }));
    expect(r).toEqual({ added: 9, skipped: 1 }); // 10 fêtes ivoiriennes, l'Ascension existait déjà
    const list = await listHolidays(s.ctx, 2026);
    expect(list).toHaveLength(10);
    expect(list.find((h) => h.date.toISOString().startsWith("2026-05-14"))!.name).toContain("personnalisé");
    expect(await generateHolidays(s.ctx, generateHolidaysSchema.parse({ country: "CI", year: 2026 }))).toEqual({ added: 0, skipped: 10 });
    expect(await listHolidays(other.ctx, 2026)).toHaveLength(0);
    await deleteHoliday(s.ctx, list[0]!.id);
    expect(await listHolidays(s.ctx, 2026)).toHaveLength(9);
    await expect(deleteHoliday(other.ctx, list[1]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("acquisition et report : demandes de congé", () => {
  it("acquisition progressive : on ne peut poser que ce qui est acquis à la fin de la période", async () => {
    const s = await setup();
    const e = await s.newEmp();
    const t = await s.type({ annualDays: 24, accrual: "MONTHLY" });
    // au 29 janvier 2027 : 24 × 29/365 = 1,9 → 1,5 jour acquis (arrondi par défaut)
    await expect(s.ask(e.id, t.id, "2027-01-25", "2027-01-29")).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Solde insuffisant") });
    await expect(s.ask(e.id, t.id, "2027-01-28", "2027-01-29")).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // 2 jours > 1,5
    await expect(s.ask(e.id, t.id, "2027-01-29", "2027-01-29")).resolves.toBeDefined(); // 1 jour
    // fin juin : bien plus acquis
    await expect(s.ask(e.id, t.id, "2027-06-14", "2027-06-18")).resolves.toBeDefined();
    const b = (await lv.leaveBalances(s.ctx, e.id, 2027, new Date("2027-06-30T00:00:00Z"))).find((x) => x.type.id === t.id)!;
    expect(b.accrued).toBe(11.5);
    expect(b.available).toBe(5.5); // 11,5 acquis − 6 jours posés (1 + 5)
  });

  it("acquisition à l'avance, proratisée l'année d'arrivée", async () => {
    const s = await setup();
    const e = await s.newEmp({ hireDate: "2027-07-05" });
    const t = await s.type({ annualDays: 24 });
    const b = (await lv.leaveBalances(s.ctx, e.id, 2027)).find((x) => x.type.id === t.id)!;
    expect(b.entitlement!.toNumber()).toBe(12); // 180/365 × 24 = 11,8 → 12
    await expect(s.ask(e.id, t.id, "2027-09-06", "2027-09-24")).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // 15 jours > 12
  });

  it("report : les jours non pris de l'année précédente s'ajoutent au droit, et se consomment d'abord", async () => {
    const s = await setup();
    const e = await s.newEmp({ hireDate: "2026-01-05" });
    const t = await s.type({ annualDays: 22, carryOverMax: 5 });
    await s.ask(e.id, t.id, "2026-08-03", "2026-08-07"); // 5 jours en 2026
    let b = (await lv.leaveBalances(s.ctx, e.id, 2027)).find((x) => x.type.id === t.id)!;
    expect(b.carryOver).toBe(5); // reliquat de 17 plafonné à 5
    expect(b.remaining!.toNumber()).toBe(27);
    // 25 jours ouvrés : possible uniquement grâce au report (22 + 5 = 27)
    await expect(s.ask(e.id, t.id, "2027-03-01", "2027-04-02")).resolves.toBeDefined(); // 25 jours
    b = (await lv.leaveBalances(s.ctx, e.id, 2027)).find((x) => x.type.id === t.id)!;
    expect(b.remaining!.toNumber()).toBe(2);
  });

  it("report avec échéance : refusé au-delà de la date limite", async () => {
    const s = await setup();
    const e = await s.newEmp({ hireDate: "2026-01-05" });
    const t = await s.type({ annualDays: 10, carryOverMax: 5, carryOverExpiryMonth: 3 });
    // 2026 : rien pris → report de 5 en 2027, utilisable jusqu'à fin mars
    await expect(s.ask(e.id, t.id, "2027-03-15", "2027-03-26")).resolves.toBeDefined(); // 10 jours, fin mars : droit 10 + report 5 → ok
    // en avril, le report n'existe plus : 10 − (10 − 5 déjà couvert par le report) …
    const b = (await lv.leaveBalances(s.ctx, e.id, 2027, new Date("2027-04-10T00:00:00Z"))).find((x) => x.type.id === t.id)!;
    expect(b.carryOver).toBe(5);
    expect(b.available).toBe(5); // 10 jours posés : 5 ont consommé le report, 5 le droit → il reste 5 du droit
  });
});

describe("paie : calendrier de l'entreprise", () => {
  it("les jours fériés réduisent les jours du mois et ne comptent pas comme jours non payés", async () => {
    const s = await setup();
    const e = await s.newEmp();
    const unpaid = (await lv.listLeaveTypes(s.ctx)).find((t) => !t.paid)!; // type « sans solde » fourni par défaut
    // mars 2026 : 22 jours ouvrés ; deux fériés en semaine → 20
    await s.holiday("2026-03-10"); // mardi
    await s.holiday("2026-03-24"); // mardi
    await s.ask(e.id, unpaid.id, "2026-03-09", "2026-03-13"); // lundi → vendredi dont le mardi férié : 4 jours non payés
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: 2026, month: 3 }));
    const slip = (await pay.getRun(s.ctx, run.id)).payslips[0]!;
    expect(Number(slip.unpaidDays)).toBe(4);
    expect(Number(slip.prorata).toFixed(6)).toBe((16 / 20).toFixed(6));
    expect(Number(slip.gross)).toBe(352000);
  });

  it("sans jour férié ni congé, le salaire est plein ; un samedi travaillé change la base du mois", async () => {
    const s = await setup();
    await s.newEmp();
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: 2026, month: 3 }));
    expect(Number((await pay.getRun(s.ctx, run.id)).payslips[0]!.prorata)).toBe(1);
  });

  it("une arrivée en cours de mois est proratisée aux jours travaillés restants (fériés exclus)", async () => {
    const s = await setup();
    await s.holiday("2026-03-24");
    const e = await s.newEmp({ hireDate: "2026-03-16", baseSalary: 400000 }); // du 16 au 31 mars : 12 jours ouvrés dont 1 férié = 11 ; mois : 22 − 1 = 21
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: 2026, month: 3 }));
    const slip = (await pay.getRun(s.ctx, run.id)).payslips.find((p) => p.employeeId === e.id)!;
    expect(Number(slip.prorata).toFixed(6)).toBe((11 / 21).toFixed(6));
  });
});
