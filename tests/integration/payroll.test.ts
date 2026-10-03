import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { employeeSchema } from "@/modules/hr/schemas";
import * as emp from "@/modules/hr/employees";
import * as lv from "@/modules/hr/leave";
import { getTrialBalance } from "./payroll-helpers";
import { buildPayrollPdf } from "@/modules/payroll/pdf";
import { employeeItemSchema, payRunSchema, payrollItemSchema, runSchema } from "@/modules/payroll/schemas";
import * as pay from "@/modules/payroll/service";
import * as tr from "@/modules/finance/treasury";
import { setCompanyModule } from "@/modules/platform/companies";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);
const Y = 2026, M = 3; // mars 2026 : 22 jours ouvrés

async function setup() {
  const co = await makeCompany("PAIE", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const accounts = await tr.listAccounts(ctx);
  const bank = accounts.find((a) => a.type === "BANK")!;
  const cash = accounts.find((a) => a.type === "CASH")!;
  return { ...co, ctx, bank, cash };
}
type S = Awaited<ReturnType<typeof setup>>;

const item = (over: Record<string, unknown>) => payrollItemSchema.parse({ effectiveFrom: "2026-01-01", ...over });
const newEmp = (s: S, over: Record<string, unknown> = {}) => emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 500000, ...over }));

/** Rubriques d'essai : retraite 6 % (déductible), impôt par tranches (0 % jusqu'à 100 000 puis 10 %), charges patronales 10 %. */
async function items(s: S) {
  await pay.saveItem(s.ctx, item({ code: "RET", name: "Retraite salariale", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", base: "GROSS", value: 6, deductibleForTax: true, sortOrder: 10 }));
  await pay.saveItem(s.ctx, item({ code: "IMPOT", name: "Impôt sur salaire", type: "DEDUCTION", category: "TAX", mode: "BRACKETS", base: "TAXABLE", brackets: [{ upTo: 100000, rate: 0 }, { upTo: null, rate: 10 }], sortOrder: 20 }));
  await pay.saveItem(s.ctx, item({ code: "PAT", name: "Charges patronales", type: "EMPLOYER", category: "SOCIAL", mode: "RATE", base: "GROSS", value: 10, sortOrder: 30 }));
}

/** A (plein), B (embauché le 16 mars), C (3 jours de congé non payé), D (salaire nul → ignoré). */
async function team(s: S) {
  const a = await newEmp(s, { firstName: "Alice", lastName: "Aka" });
  const b = await newEmp(s, { firstName: "Bruno", lastName: "Bamba", hireDate: "2026-03-16", baseSalary: 220000 });
  const c = await newEmp(s, { firstName: "Carine", lastName: "Coulibaly", baseSalary: 440000 });
  const dd = await newEmp(s, { firstName: "David", lastName: "Dosso", baseSalary: 0 });
  const unpaid = (await lv.listLeaveTypes(s.ctx)).find((t) => t.name === "Sans solde")!;
  const l = await lv.requestLeave(s.ctx, { employeeId: c.id, typeId: unpaid.id, startDate: "2026-03-09", endDate: "2026-03-11", reason: "" });
  expect(l.status).toBe("APPROVED"); // administrateur unique : accepté d'office
  return { a, b, c, d: dd };
}

const nums = (r: { totalGross: unknown; totalDeductions: unknown; totalNet: unknown; totalEmployer: unknown }) => [r.totalGross, r.totalDeductions, r.totalNet, r.totalEmployer].map(Number);
const lineAmount = (slip: { lines: { code: string; amount: unknown }[] }, code: string) => Number(slip.lines.find((l) => l.code === code)?.amount ?? 0);

describe("rubriques versionnées", () => {
  it("une nouvelle version clôture la précédente ; la version applicable dépend de la date", async () => {
    const s = await setup();
    await pay.saveItem(s.ctx, item({ code: "RET", name: "Retraite", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", value: 6, effectiveFrom: "2026-01-01" }));
    await pay.saveItem(s.ctx, item({ code: "ret", name: "Retraite", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", value: 7, effectiveFrom: "2026-07-01" }));
    const all = await pay.listItems(s.ctx);
    expect(all).toHaveLength(2);
    expect(all.find((i) => Number(i.value) === 6)!.effectiveTo!.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(Number((await pay.itemsAt(s.ctx.db, new Date("2026-03-31")))[0]!.value)).toBe(6);
    expect(Number((await pay.itemsAt(s.ctx.db, new Date("2026-08-31")))[0]!.value)).toBe(7);
    // même date d'effet : mise à jour, pas de doublon
    await pay.saveItem(s.ctx, item({ code: "RET", name: "Retraite (révisée)", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", value: 7.5, effectiveFrom: "2026-07-01" }));
    expect(await pay.listItems(s.ctx)).toHaveLength(2);
    // version antérieure à une version existante, type différent, désactivation
    await expect(pay.saveItem(s.ctx, item({ code: "RET", name: "Retraite", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", value: 5, effectiveFrom: "2026-04-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(pay.saveItem(s.ctx, item({ code: "RET", name: "Retraite", type: "EMPLOYER", category: "SOCIAL", mode: "RATE", value: 5, effectiveFrom: "2027-01-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const v2 = (await pay.listItems(s.ctx)).find((i) => Number(i.value) === 7.5)!;
    await pay.toggleItem(s.ctx, v2.id, false);
    expect(await pay.itemsAt(s.ctx.db, new Date("2026-08-31"))).toHaveLength(0);
  });

  it("validation des rubriques : pourcentage ≤ 100, barème cohérent, gain en % sur le salaire de base", () => {
    const bad = (over: Record<string, unknown>) => payrollItemSchema.safeParse({ code: "XX", name: "Test", type: "DEDUCTION", mode: "RATE", value: 5, effectiveFrom: "2026-01-01", ...over }).success;
    expect(bad({})).toBe(true);
    expect(bad({ value: 120 })).toBe(false);
    expect(bad({ mode: "BRACKETS", brackets: [] })).toBe(false);
    expect(bad({ mode: "BRACKETS", brackets: [{ upTo: 200, rate: 5 }, { upTo: 100, rate: 5 }] })).toBe(false);
    expect(bad({ mode: "BRACKETS", brackets: [{ upTo: 100, rate: 5 }, { upTo: null, rate: 5 }] })).toBe(true);
    expect(bad({ type: "EARNING", mode: "BRACKETS", brackets: [{ upTo: null, rate: 5 }] })).toBe(false);
    expect(bad({ type: "EARNING", mode: "RATE", base: "GROSS" })).toBe(false);
    expect(bad({ type: "EARNING", mode: "RATE", base: "BASE", category: "OTHER" })).toBe(true);
    expect(bad({ type: "EMPLOYER", category: "TAX" })).toBe(false);
  });

  it("le modèle indicatif ne se charge qu'à vide", async () => {
    const s = await setup();
    await pay.installSampleItems(s.ctx);
    expect((await pay.listItems(s.ctx)).length).toBeGreaterThanOrEqual(5);
    await expect(pay.installSampleItems(s.ctx)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("campagne de paie", () => {
  it("calcule brut, retenues, net et charges ; prorata d'entrée et de congé non payé ; salaire nul ignoré", async () => {
    const s = await setup();
    await items(s);
    const t = await team(s);
    const { run, skipped } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    expect(skipped).toEqual(["Dosso David"]);
    const full = await pay.getRun(s.ctx, run.id);
    expect(full.status).toBe("DRAFT");
    const by = (id: string) => full.payslips.find((p) => p.employeeId === id)!;
    const slips = await Promise.all(full.payslips.map((p) => s.ctx.db.payslip.findFirstOrThrow({ where: { id: p.id }, include: { lines: true } })));
    const sl = (id: string) => slips.find((p) => p.employeeId === id)!;
    // A : brut 500 000 ; retraite 30 000 ; impôt (470 000 − 100 000) × 10 % = 37 000 ; net 433 000 ; patronal 50 000
    expect([Number(by(t.a.id).gross), Number(by(t.a.id).totalDeductions), Number(by(t.a.id).netPay), Number(by(t.a.id).employerCharges)]).toEqual([500000, 67000, 433000, 50000]);
    expect(lineAmount(sl(t.a.id), "IMPOT")).toBe(37000);
    // B : 220 000 × 12/22 = 120 000
    expect(Number(by(t.b.id).prorata).toFixed(6)).toBe((12 / 22).toFixed(6));
    expect([Number(by(t.b.id).gross), Number(by(t.b.id).netPay)]).toEqual([120000, 111520]);
    // C : 440 000 × 19/22 = 380 000 ; 3 jours non payés
    expect(Number(by(t.c.id).unpaidDays)).toBe(3);
    expect([Number(by(t.c.id).gross), Number(by(t.c.id).totalDeductions), Number(by(t.c.id).netPay)]).toEqual([380000, 48520, 331480]);
    expect(nums(full)).toEqual([1000000, 124000, 876000, 100000]);
    expect(full.payslips).toHaveLength(3);
    // recalcul idempotent
    await pay.recalculateRun(s.ctx, run.id);
    expect(nums(await pay.getRun(s.ctx, run.id))).toEqual([1000000, 124000, 876000, 100000]);
    // une seule campagne active par mois ; mois futur refusé
    await expect(pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("existe déjà") });
    await expect(pay.createRun(s.ctx, { year: 2099, month: 1 })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("primes et retenues propres au salarié (avance remboursée) ; net négatif refusé", async () => {
    const s = await setup();
    await items(s);
    const a = await newEmp(s, { baseSalary: 300000 });
    await pay.addEmployeeItem(s.ctx, employeeItemSchema.parse({ employeeId: a.id, name: "Prime de panier", type: "EARNING", amount: 15000, taxable: true, startDate: "2026-01-01" }));
    const adv = await pay.addEmployeeItem(s.ctx, employeeItemSchema.parse({ employeeId: a.id, name: "Remboursement d'avance", type: "DEDUCTION", category: "OTHER", amount: 40000, startDate: "2026-01-01", endDate: "2026-12-31" }));
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    const slip = await s.ctx.db.payslip.findFirstOrThrow({ where: { runId: run.id }, include: { lines: true } });
    expect(Number(slip.gross)).toBe(315000);
    expect(lineAmount(slip, "RETENUE")).toBe(40000);
    expect(slip.lines.find((l) => l.code === "RETENUE")).toMatchObject({ category: "OTHER" });
    // une retenue démesurée rend le net négatif : le calcul est refusé avec un message clair
    await pay.removeEmployeeItem(s.ctx, adv.id);
    await pay.addEmployeeItem(s.ctx, employeeItemSchema.parse({ employeeId: a.id, name: "Saisie énorme", type: "DEDUCTION", amount: 900000, startDate: "2026-01-01" }));
    await expect(pay.recalculateRun(s.ctx, run.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Net négatif") });
    // l'échec n'a pas détruit les bulletins existants (transaction annulée)
    expect(await s.ctx.db.payslip.count({ where: { runId: run.id } })).toBe(1);
  });

  it("validation : bulletins numérotés sans trou, campagne figée ; brouillon supprimable ; annulation d'une campagne validée", async () => {
    const s = await setup();
    await items(s);
    await team(s);
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    const v = await pay.validateRun(s.ctx, run.id);
    expect(v.status).toBe("VALIDATED");
    const numbers = (await s.ctx.db.payslip.findMany({ where: { runId: run.id }, select: { number: true } })).map((p) => p.number).sort();
    expect(numbers).toEqual([`BUL-${Y}-00001`, `BUL-${Y}-00002`, `BUL-${Y}-00003`]);
    await expect(pay.validateRun(s.ctx, run.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(pay.recalculateRun(s.ctx, run.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await pay.cancelRun(s.ctx, run.id);
    expect((await pay.getRun(s.ctx, run.id)).status).toBe("CANCELLED");
    // une campagne annulée permet d'en refaire une pour le même mois
    const again = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    await pay.cancelRun(s.ctx, again.run.id); // brouillon : supprimé
    await expect(pay.getRun(s.ctx, again.run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // sans salarié payable : rien à valider
    const empty = await setup();
    const r0 = await pay.createRun(empty.ctx, runSchema.parse({ year: Y, month: M }));
    await expect(pay.validateRun(empty.ctx, r0.run.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("paiement, trésorerie et comptabilité", () => {
  it("écriture de paie équilibrée ; paiement : sortie de trésorerie + écriture ; caisse insuffisante refusée ; campagne payée non annulable", async () => {
    const s = await setup();
    await items(s);
    await team(s);
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    await pay.validateRun(s.ctx, run.id);
    const entry = await s.ctx.db.journalEntry.findFirstOrThrow({ where: { sourceType: "payroll", sourceId: run.id }, include: { lines: { include: { ledgerAccount: true }, orderBy: { position: "asc" } } } });
    expect(entry.date.toISOString().slice(0, 10)).toBe("2026-03-31");
    const shape = entry.lines.map((l) => `${l.ledgerAccount.code}:${Number(l.debit) ? `D${Number(l.debit)}` : `C${Number(l.credit)}`}`);
    expect(shape).toEqual(["661:D1000000", "664:D100000", "421:C876000", "431:C160000", "447:C64000"]);

    // paiement sans compte, ou depuis une caisse vide : refusé et rien n'est modifié
    await expect(pay.payRun(s.ctx, payRunSchema.parse({ id: run.id, date: today() }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(pay.payRun(s.ctx, payRunSchema.parse({ id: run.id, accountId: s.cash.id, date: today() }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Solde insuffisant") });
    expect((await pay.getRun(s.ctx, run.id)).status).toBe("VALIDATED");
    expect(await s.ctx.db.journalEntry.count({ where: { sourceType: "payroll_payment" } })).toBe(0);

    const paid = await pay.payRun(s.ctx, payRunSchema.parse({ id: run.id, accountId: s.bank.id, date: today() }));
    expect(paid.status).toBe("PAID");
    expect((await tr.getAccount(s.ctx, s.bank.id)).balance.toNumber()).toBe(-876000);
    const trx = await s.ctx.db.financialTransaction.findFirstOrThrow({ where: { sourceType: "payroll", sourceId: run.id } });
    expect(Number(trx.amount)).toBe(876000);
    const payEntry = await s.ctx.db.journalEntry.findFirstOrThrow({ where: { sourceType: "payroll_payment", sourceId: run.id }, include: { lines: { include: { ledgerAccount: true }, orderBy: { position: "asc" } } } });
    expect(payEntry.lines.map((l) => `${l.ledgerAccount.code}:${Number(l.debit) ? `D${Number(l.debit)}` : `C${Number(l.credit)}`}`)).toEqual(["421:D876000", "521:C876000"]);
    const tb = await getTrialBalance(s);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.code === "421")!.balance).toBe(0); // salaires dus soldés
    expect(tb.rows.find((r) => r.code === "521")!.balance).toBe(-876000); // = solde du compte de trésorerie
    await expect(pay.payRun(s.ctx, payRunSchema.parse({ id: run.id, accountId: s.bank.id, date: today() }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(pay.cancelRun(s.ctx, run.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("annulation d'une campagne validée : écriture contre-passée ; sans module Comptabilité ni Finance, aucune écriture ni mouvement", async () => {
    const s = await setup();
    await items(s);
    await newEmp(s, { baseSalary: 300000 });
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    await pay.validateRun(s.ctx, run.id);
    await pay.cancelRun(s.ctx, run.id);
    const rev = await s.ctx.db.journalEntry.findFirstOrThrow({ where: { sourceType: "payroll:reversal", sourceId: run.id }, include: { lines: { include: { ledgerAccount: true } } } });
    expect(rev.lines.find((l) => l.ledgerAccount.code === "661")!.credit.toString()).toBe("300000");

    await setCompanyModule(s.company.id, "accounting", false);
    await setCompanyModule(s.company.id, "finance", false);
    const ctx = await ctxFor(s.owner.id, s.company.id);
    const r2 = await pay.createRun(ctx, runSchema.parse({ year: Y, month: M }));
    await pay.validateRun(ctx, r2.run.id);
    expect(await ctx.db.journalEntry.count({ where: { sourceId: r2.run.id } })).toBe(0);
    const paid = await pay.payRun(ctx, payRunSchema.parse({ id: r2.run.id, date: today() })); // sans Finance : compte facultatif
    expect(paid.status).toBe("PAID");
    expect(await ctx.db.financialTransaction.count({ where: { sourceType: "payroll" } })).toBe(0);
  });

  it("CONCURRENCE : validations et paiements simultanés → un seul effet, numéros sans doublon", async () => {
    const s = await setup();
    await items(s);
    await team(s);
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    const v = await Promise.allSettled(Array.from({ length: 5 }, () => pay.validateRun(s.ctx, run.id)));
    expect(v.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await s.ctx.db.payslip.findMany({ where: { runId: run.id }, select: { number: true } })).map((p) => p.number).sort()).toEqual([`BUL-${Y}-00001`, `BUL-${Y}-00002`, `BUL-${Y}-00003`]);
    const p = await Promise.allSettled(Array.from({ length: 5 }, () => pay.payRun(s.ctx, payRunSchema.parse({ id: run.id, accountId: s.bank.id, date: today() }))));
    expect(p.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await s.ctx.db.financialTransaction.count({ where: { sourceType: "payroll", sourceId: run.id } })).toBe(1);
    expect(await s.ctx.db.journalEntry.count({ where: { sourceType: "payroll_payment", sourceId: run.id } })).toBe(1);
  });
});

describe("bulletins : accès et PDF", () => {
  it("le salarié ne voit que ses bulletins validés ; la paie voit tout ; PDF contrôlé", async () => {
    const s = await setup();
    await items(s);
    const m1 = await addMember(s.company.id, "employee");
    const m2 = await addMember(s.company.id, "employee");
    const e1 = await newEmp(s, { firstName: "Ana", lastName: "Aka", userId: m1.user.id });
    const e2 = await newEmp(s, { firstName: "Bob", lastName: "Bamba", userId: m2.user.id, baseSalary: 400000 });
    const c1 = await ctxFor(m1.user.id, s.company.id);
    const { run } = await pay.createRun(s.ctx, runSchema.parse({ year: Y, month: M }));
    const slip1 = await s.ctx.db.payslip.findFirstOrThrow({ where: { runId: run.id, employeeId: e1.id } });
    const slip2 = await s.ctx.db.payslip.findFirstOrThrow({ where: { runId: run.id, employeeId: e2.id } });
    // brouillon : invisible pour le salarié
    await expect(pay.getPayslip(c1, slip1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pay.listPayslips(c1, { skip: 0, take: 10 })).total).toBe(0);
    await pay.validateRun(s.ctx, run.id);
    expect((await pay.getPayslip(c1, slip1.id)).employee.id).toBe(e1.id);
    await expect(pay.getPayslip(c1, slip2.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // bulletin d'un collègue
    expect((await pay.listPayslips(c1, { skip: 0, take: 10 })).rows.map((r) => r.employee.id)).toEqual([e1.id]);
    expect((await pay.listPayslips(s.ctx, { skip: 0, take: 10 })).total).toBe(2);
    // un membre sans « bulletins » ni lien salarié ne voit rien
    const stranger = await addMember(s.company.id, "viewer");
    expect((await pay.listPayslips(await ctxFor(stranger.user.id, s.company.id), { skip: 0, take: 10 })).total).toBe(0);
    // PDF
    const own = await buildPayrollPdf(c1, "payslip", slip1.id);
    expect(own.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(own.filename).toBe(`bulletin-BUL-${Y}-0000${(await s.ctx.db.payslip.findFirstOrThrow({ where: { id: slip1.id } })).number!.slice(-1)}.pdf`);
    await expect(buildPayrollPdf(c1, "payslip", slip2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await buildPayrollPdf(s.ctx, "payslip", slip2.id)).data.length).toBeGreaterThan(1000);
  });

  it("ISOLATION : aucune lecture, calcul, validation ou paiement sur la paie d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    await items(B);
    await newEmp(B, { baseSalary: 300000 });
    const { run } = await pay.createRun(B.ctx, runSchema.parse({ year: Y, month: M }));
    const slip = await B.ctx.db.payslip.findFirstOrThrow({ where: { runId: run.id } });
    await expect(pay.getRun(A.ctx, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pay.getPayslip(A.ctx, slip.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pay.recalculateRun(A.ctx, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pay.validateRun(A.ctx, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pay.payRun(A.ctx, payRunSchema.parse({ id: run.id, accountId: A.bank.id, date: today() }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pay.cancelRun(A.ctx, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(buildPayrollPdf(A.ctx, "payslip", slip.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await pay.listItems(A.ctx)).toHaveLength(0);
    expect((await pay.listRuns(A.ctx))).toHaveLength(0);
    expect((await pay.listPayslips(A.ctx, { skip: 0, take: 10 })).total).toBe(0);
    await pay.validateRun(B.ctx, run.id);
    // payer depuis le compte d'une autre entreprise
    await expect(pay.payRun(B.ctx, payRunSchema.parse({ id: run.id, accountId: A.bank.id, date: today() }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const foreignEmp = await newEmp(B, { firstName: "Z" });
    await expect(pay.addEmployeeItem(A.ctx, employeeItemSchema.parse({ employeeId: foreignEmp.id, name: "Prime", type: "EARNING", amount: 1000, startDate: today() }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
