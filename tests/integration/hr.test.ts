import { describe, expect, it } from "vitest";
import { decideApproval, listApprovals, pendingDecisionCount } from "@/core/approvals";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import * as ex from "@/modules/finance/expenses";
import { expenseSchema } from "@/modules/finance/schemas";
import * as tr from "@/modules/finance/treasury";
import * as emp from "@/modules/hr/employees";
import * as lv from "@/modules/hr/leave";
import * as pp from "@/modules/hr/people";
import { attendanceSchema, employeeSchema, evaluationSchema, trainingSchema } from "@/modules/hr/schemas";
import * as org from "@/modules/org/service";
import * as invoices from "@/modules/sales/invoices";
import { invoiceSchema } from "@/modules/sales/schemas";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("RH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  return { ...co, ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

const newEmp = (s: S, over: Record<string, unknown> = {}, ctx = s.ctx) => emp.createEmployee(ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000, jobTitle: "Comptable", ...over }));
const leaveInput = (employeeId: string, typeId: string, startDate: string, endDate: string) => ({ employeeId, typeId, startDate, endDate, reason: "" });
const annual = async (s: S) => (await lv.listLeaveTypes(s.ctx)).find((t) => t.name === "Congé annuel")!;

/** Salarié lié à un utilisateur au rôle « Employé » ; renvoie son contexte. */
async function selfService(s: S, over: Record<string, unknown> = {}) {
  const m = await addMember(s.company.id, "employee");
  const e = await newEmp(s, { userId: m.user.id, ...over });
  return { m, e, ctx: await ctxFor(m.user.id, s.company.id) };
}

describe("organisation", () => {
  it("agences (un seul siège, code unique), départements sans boucle, centres de coûts en majuscules", async () => {
    const s = await setup();
    const a = await org.createBranch(s.ctx, { name: "Abidjan", code: "abj", isHeadquarters: true } as never);
    expect(a.code).toBe("ABJ");
    const b = await org.createBranch(s.ctx, { name: "Bouaké", code: "BKE", isHeadquarters: true } as never);
    const branches = await org.listBranches(s.ctx);
    expect(branches.filter((x) => x.isHeadquarters).map((x) => x.id)).toEqual([b.id]);
    await expect(org.createBranch(s.ctx, { name: "Doublon", code: "ABJ", isHeadquarters: false } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const root = await org.createDepartment(s.ctx, { name: "Direction", code: "dir" } as never);
    const child = await org.createDepartment(s.ctx, { name: "Finance", parentId: root.id } as never);
    const leaf = await org.createDepartment(s.ctx, { name: "Comptabilité", parentId: child.id } as never);
    await expect(org.updateDepartment(s.ctx, { id: root.id, name: "Direction", parentId: leaf.id, isActive: true } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(org.updateDepartment(s.ctx, { id: root.id, name: "Direction", parentId: root.id, isActive: true } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const cc = await org.createCostCenter(s.ctx, { code: "com", name: "Commercial" });
    expect(cc.code).toBe("COM");
    await expect(org.createCostCenter(s.ctx, { code: "COM", name: "Autre" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const site = await org.createSite(s.ctx, { name: "Dépôt Nord", type: "dépôt", branchId: a.id } as never);
    expect(site.branchId).toBe(a.id);
  });

  it("une agence ou un département avec des salariés actifs ne se désactive pas", async () => {
    const s = await setup();
    const br = await org.createBranch(s.ctx, { name: "Abidjan", code: "ABJ" } as never);
    const dep = await org.createDepartment(s.ctx, { name: "Ventes" } as never);
    const e = await newEmp(s, { branchId: br.id, departmentId: dep.id });
    await expect(org.updateBranch(s.ctx, { id: br.id, name: "Abidjan", code: "ABJ", isActive: false, isHeadquarters: false } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(org.updateDepartment(s.ctx, { id: dep.id, name: "Ventes", isActive: false } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await emp.terminateEmployee(s.ctx, { id: e.id, endDate: today(), reason: "" });
    await expect(org.updateBranch(s.ctx, { id: br.id, name: "Abidjan", code: "ABJ", isActive: false, isHeadquarters: false } as never)).resolves.toMatchObject({ isActive: false });
  });

  it("ISOLATION : les références d'agence / centre de coûts d'une autre entreprise sont refusées partout", async () => {
    const A = await setup();
    const B = await setup();
    const brB = await org.createBranch(B.ctx, { name: "Agence B", code: "B1" } as never);
    const ccB = await org.createCostCenter(B.ctx, { code: "CCB", name: "Centre B" });
    const depB = await org.createDepartment(B.ctx, { name: "Dép B" } as never);
    const tax = await A.ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
    const customer = await crm.createCustomer(A.ctx, customerSchema.parse({ type: "COMPANY", name: "Client A", paymentTermsDays: 30 }));
    const line = [{ description: "X", unit: "u", quantity: 1, unitPrice: 1000, discountPct: 0, taxId: tax.id }];
    await expect(invoices.createInvoice(A.ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: today(), branchId: brB.id, lines: line }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invoices.createInvoice(A.ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: today(), costCenterId: ccB.id, lines: line }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const cat = (await tr.listCategories(A.ctx, { kind: "EXPENSE" }))[0]!;
    await expect(ex.createExpense(A.ctx, expenseSchema.parse({ date: today(), categoryId: cat.id, description: "Test", amount: 1000, branchId: brB.id }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newEmp(A, { departmentId: depB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newEmp(A, { branchId: brB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(org.updateBranch(A.ctx, { id: brB.id, name: "Piratée", isActive: true, isHeadquarters: false } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(org.updateCostCenter(A.ctx, { id: ccB.id, code: "CCB", name: "Piraté", isActive: true } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await org.listBranches(A.ctx)).map((b) => b.name)).not.toContain("Agence B"); // l'entreprise A ne voit jamais l'agence de B
    expect((await org.listCostCenters(A.ctx)).map((c) => c.code)).not.toContain("CCB");
  });

  it("analyse par agence et centre de coûts : produits, achats et dépenses affectés", async () => {
    const s = await setup();
    const br = await org.createBranch(s.ctx, { name: "Abidjan", code: "ABJ" } as never);
    const cc = await org.createCostCenter(s.ctx, { code: "COM", name: "Commercial" });
    const tax = await s.ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
    const customer = await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Client", paymentTermsDays: 30 }));
    const draft = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: today(), branchId: br.id, costCenterId: cc.id, lines: [{ description: "X", unit: "u", quantity: 10, unitPrice: 10000, discountPct: 0, taxId: tax.id }] }));
    await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
    const rows = await org.orgAnalysis(s.ctx, "branch");
    expect(rows.find((r) => r.id === br.id)!.revenue.toNumber()).toBe(100000);
    const byCc = await org.orgAnalysis(s.ctx, "costCenter");
    expect(byCc.find((r) => r.id === cc.id)!.result.toNumber()).toBe(100000);
  });
});

describe("salariés", () => {
  it("fiche, matricule, références validées, boucle hiérarchique et compte utilisateur", async () => {
    const s = await setup();
    const dep = await org.createDepartment(s.ctx, { name: "Finance" } as never);
    const boss = await newEmp(s, { firstName: "Chef", lastName: "Boss", departmentId: dep.id });
    expect(boss.number).toBe("EMP-0001");
    const e = await newEmp(s, { managerId: boss.id, departmentId: dep.id });
    expect(e.number).toBe("EMP-0002");
    await expect(emp.updateEmployee(s.ctx, { ...employeeSchema.parse({ firstName: "Chef", lastName: "Boss", hireDate: "2020-01-06", managerId: e.id }), id: boss.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // boucle
    await expect(emp.updateEmployee(s.ctx, { ...employeeSchema.parse({ firstName: "Chef", lastName: "Boss", hireDate: "2020-01-06", managerId: boss.id }), id: boss.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const user = await addMember(s.company.id, "employee");
    await newEmp(s, { firstName: "Lié", userId: user.user.id });
    await expect(newEmp(s, { firstName: "Doublon", userId: user.user.id })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("déjà lié") });
    const stranger = await addMember((await setup()).company.id, "employee");
    await expect(newEmp(s, { userId: stranger.user.id })).rejects.toMatchObject({ code: "NOT_FOUND" }); // pas membre de cette entreprise
    const found = await emp.listEmployees(s.ctx, { q: "boss", skip: 0, take: 10 });
    expect(found.rows.map((r) => r.id)).toEqual([boss.id]);
  });

  it("rémunération et pièce d'identité masquées sans droit « contrats/paie » ; définir un salaire exige ce droit", async () => {
    const s = await setup();
    await newEmp(s, { nationalId: "CI-123456", payoutReference: "CI93 0001 1234" });
    const viewer = await addMember(s.company.id, "project_manager"); // hr.employee.read seulement
    const vctx = await ctxFor(viewer.user.id, s.company.id);
    const row = (await emp.listEmployees(vctx, { skip: 0, take: 10 })).rows[0]!;
    expect(row.baseSalary).toBeNull();
    expect(row.nationalId).toBeNull();
    expect(row.payoutReference).toBeNull();
    const detail = await emp.getEmployee(vctx, row.id);
    expect(detail.baseSalary).toBeNull();
    await expect(emp.listContracts(vctx, row.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const hr = await addMember(s.company.id, "hr");
    const full = (await emp.listEmployees(await ctxFor(hr.user.id, s.company.id), { skip: 0, take: 10 })).rows[0]!;
    expect(Number(full.baseSalary)).toBe(300000);
    expect(full.nationalId).toBe("CI-123456");
    await expect(newEmp(s, { firstName: "Sal" }, vctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // mise à jour sans droit : le salaire n'est jamais modifié
    const upd = await emp.updateEmployee(vctx, { ...employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 999999, jobTitle: "Directrice" }), id: row.id });
    expect(Number(upd.baseSalary)).toBe(300000);
    expect(upd.jobTitle).toBe("Directrice");
  });

  it("contrats : le nouveau clôture le précédent et met à jour le salaire ; CDD avec fin obligatoire ; échéances", async () => {
    const s = await setup();
    const e = await newEmp(s, { baseSalary: 0 });
    const c1 = await emp.addContract(s.ctx, { employeeId: e.id, type: "FIXED_TERM", startDate: "2026-01-01", endDate: "2026-12-31", salary: 250000, jobTitle: "Assistante", notes: "" } as never);
    await expect(emp.addContract(s.ctx, { employeeId: e.id, type: "FIXED_TERM", startDate: "2027-01-01", salary: 1, notes: "" } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(Number((await emp.getEmployee(s.ctx, e.id)).baseSalary)).toBe(250000);
    const c2 = await emp.addContract(s.ctx, { employeeId: e.id, type: "PERMANENT", startDate: "2026-07-01", salary: 320000, notes: "" } as never);
    const list = await emp.listContracts(s.ctx, e.id);
    expect(list.map((c) => c.id)).toEqual([c2.id, c1.id]);
    expect(list[1]!.endDate!.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(Number((await emp.getEmployee(s.ctx, e.id)).baseSalary)).toBe(320000);
    await expect(emp.addContract(s.ctx, { employeeId: e.id, type: "PERMANENT", startDate: "2026-03-01", salary: 1, notes: "" } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const e2 = await newEmp(s, { firstName: "Bientôt", baseSalary: 0 });
    await emp.addContract(s.ctx, { employeeId: e2.id, type: "FIXED_TERM", startDate: "2026-01-01", endDate: soon, salary: 100000, notes: "" } as never);
    expect((await emp.endingContracts(s.ctx, 30)).map((c) => c.employee.firstName)).toEqual(["Bientôt"]);
  });

  it("sortie : contrats clôturés, congés en attente annulés, fiche figée", async () => {
    const s = await setup();
    const { e, ctx } = await selfService(s);
    await emp.addContract(s.ctx, { employeeId: e.id, type: "PERMANENT", startDate: "2020-01-06", salary: 300000, notes: "" } as never);
    const type = await annual(s);
    const req = await lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-03-01", "2027-03-05"));
    expect(req.status).toBe("PENDING");
    await emp.terminateEmployee(s.ctx, { id: e.id, endDate: "2026-12-31", reason: "Démission" });
    const after = await emp.getEmployee(s.ctx, e.id);
    expect(after.status).toBe("TERMINATED");
    expect((await emp.listContracts(s.ctx, e.id))[0]!.endDate!.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect((await lv.getLeaveRequest(s.ctx, req.id)).status).toBe("CANCELLED");
    expect(await pendingDecisionCount(s.ctx)).toBe(0);
    await expect(emp.updateEmployee(s.ctx, { ...employeeSchema.parse({ firstName: "X", lastName: "Y", hireDate: "2020-01-06" }), id: e.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(emp.terminateEmployee(s.ctx, { id: e.id, endDate: today(), reason: "" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("congés", () => {
  it("jours ouvrés calculés côté serveur", () => {
    expect(lv.workingDays(new Date("2027-03-01"), new Date("2027-03-05"))).toBe(5);
    expect(lv.workingDays(new Date("2027-03-05"), new Date("2027-03-08"))).toBe(2); // vendredi + lundi
    expect(lv.workingDays(new Date("2027-03-06"), new Date("2027-03-07"))).toBe(0); // week-end
  });

  it("demande → validation par un tiers → solde ; chevauchement et dépassement refusés", async () => {
    const s = await setup();
    const { e, ctx } = await selfService(s);
    const type = await annual(s);
    const r1 = await lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-03-01", "2027-03-05"));
    expect(Number(r1.days)).toBe(5);
    expect(r1.status).toBe("PENDING");
    expect(r1.autoApproved).toBe(false);
    // le salarié ne valide pas sa propre demande ; l'administrateur voit la demande
    expect(await pendingDecisionCount(ctx)).toBe(0);
    expect(await pendingDecisionCount(s.ctx)).toBe(1);
    const appr = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 5 })).rows[0]!;
    expect(appr).toMatchObject({ resourceType: "leave", resourceId: r1.id });
    expect(await platformDb.notification.count({ where: { companyId: s.company.id, userId: s.owner.id, type: "leave.request" } })).toBe(1);
    await expect(decideApproval(ctx, { id: appr.id, decision: "APPROVED" })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|BUSINESS_RULE/) });
    await decideApproval(s.ctx, { id: appr.id, decision: "APPROVED", comment: "Bon congé" });
    expect((await lv.getLeaveRequest(ctx, r1.id)).status).toBe("APPROVED");

    await expect(lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-03-03", "2027-03-10"))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("existe déjà") });
    await lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-03-08", "2027-03-26")); // 15 jours
    const bal = (await lv.leaveBalances(ctx, e.id, 2027)).find((b) => b.type.id === type.id)!;
    expect(bal.taken.toNumber()).toBe(5);
    expect(bal.pending.toNumber()).toBe(15);
    expect(bal.remaining!.toNumber()).toBe(2);
    await expect(lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-04-05", "2027-04-09"))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Solde insuffisant") });
    // type non plafonné (maladie) : pas de limite
    const sick = (await lv.listLeaveTypes(s.ctx)).find((t) => t.name === "Maladie")!;
    await expect(lv.requestLeave(ctx, leaveInput(e.id, sick.id, "2027-04-05", "2027-04-30"))).resolves.toMatchObject({ status: "PENDING" });
  });

  it("refus avec motif obligatoire ; période sur deux années, week-end seul, avant l'embauche refusés", async () => {
    const s = await setup();
    const { e, ctx } = await selfService(s, { hireDate: "2026-06-01" });
    const type = await annual(s);
    const r = await lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-05-03", "2027-05-04"));
    const appr = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 5 })).rows[0]!;
    await expect(decideApproval(s.ctx, { id: appr.id, decision: "REJECTED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await decideApproval(s.ctx, { id: appr.id, decision: "REJECTED", comment: "Période de clôture" });
    expect((await lv.getLeaveRequest(ctx, r.id)).status).toBe("REJECTED");
    await expect(lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-12-30", "2028-01-04"))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("deux années") });
    await expect(lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-03-06", "2027-03-07"))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("jour ouvré") });
    await expect(lv.requestLeave(ctx, leaveInput(e.id, type.id, "2026-03-02", "2026-03-03"))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("embauche") });
    await expect(lv.requestLeave(ctx, leaveInput(e.id, type.id, "2027-03-05", "2027-03-01"))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("droits : pour soi uniquement (sauf RH) ; visibilité limitée ; annulation", async () => {
    const s = await setup();
    const a = await selfService(s, { firstName: "Ana" });
    const b = await selfService(s, { firstName: "Bob" });
    const second = await addMember(s.company.id, "admin"); // second approbateur : la demande déposée par l'administrateur reste à valider
    const sctx = await ctxFor(second.user.id, s.company.id);
    const type = await annual(s);
    await expect(lv.requestLeave(a.ctx, leaveInput(b.e.id, type.id, "2027-03-01", "2027-03-02"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ra = await lv.requestLeave(a.ctx, leaveInput(a.e.id, type.id, "2027-03-01", "2027-03-02"));
    await lv.requestLeave(s.ctx, leaveInput(b.e.id, type.id, "2027-03-08", "2027-03-09")); // l'administrateur le fait pour Bob
    expect((await lv.listLeaveRequests(a.ctx, { skip: 0, take: 10 })).rows.map((r) => r.employee.firstName)).toEqual(["Ana"]);
    expect((await lv.listLeaveRequests(s.ctx, { skip: 0, take: 10 })).total).toBe(2);
    await expect(lv.getLeaveRequest(b.ctx, ra.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lv.cancelLeave(b.ctx, ra.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await lv.cancelLeave(a.ctx, ra.id);
    expect((await lv.getLeaveRequest(s.ctx, ra.id)).status).toBe("CANCELLED");
    await expect(lv.cancelLeave(a.ctx, ra.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(await pendingDecisionCount(sctx)).toBe(1); // seule la demande de Bob reste à valider
    expect(await pendingDecisionCount(s.ctx)).toBe(0); // le déposant ne la valide pas lui-même
  });

  it("administrateur unique : sa demande ne peut être validée par personne d'autre → acceptée d'office et tracée", async () => {
    const s = await setup();
    const own = await newEmp(s, { userId: s.owner.id });
    const type = await annual(s);
    const r = await lv.requestLeave(s.ctx, leaveInput(own.id, type.id, "2027-03-01", "2027-03-02"));
    expect(r).toMatchObject({ status: "APPROVED", autoApproved: true });
    const log = await s.ctx.db.auditLog.findFirst({ where: { action: "hr.leave.request" }, orderBy: { createdAt: "desc" } });
    expect(log!.summary).toContain("accepté d'office");
  });

  it("ISOLATION : aucune lecture, demande ou annulation sur les données RH d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const eB = await newEmp(B, {});
    const typeB = await annual(B);
    const rB = await lv.requestLeave(B.ctx, leaveInput(eB.id, typeB.id, "2027-03-01", "2027-03-02"));
    await expect(emp.getEmployee(A.ctx, eB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(emp.listContracts(A.ctx, eB.id)).resolves.toEqual([]);
    await expect(emp.addContract(A.ctx, { employeeId: eB.id, type: "PERMANENT", startDate: today(), salary: 1, notes: "" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(emp.terminateEmployee(A.ctx, { id: eB.id, endDate: today(), reason: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lv.requestLeave(A.ctx, leaveInput(eB.id, typeB.id, "2027-04-05", "2027-04-06"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lv.getLeaveRequest(A.ctx, rB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lv.cancelLeave(A.ctx, rB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pp.setAttendance(A.ctx, attendanceSchema.parse({ employeeId: eB.id, date: "2026-09-14", status: "PRESENT" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pp.createEvaluation(A.ctx, evaluationSchema.parse({ employeeId: eB.id, period: "2026", date: today(), score: 4 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await emp.listEmployees(A.ctx, { skip: 0, take: 10 })).total).toBe(0);
    expect((await lv.listLeaveRequests(A.ctx, { skip: 0, take: 10 })).total).toBe(0);
    expect(await pendingDecisionCount(A.ctx)).toBe(0);
  });
});

describe("présences, évaluations et formations", () => {
  it("pointage, jour futur et congé refusés, présence en masse, feuille et récapitulatif", async () => {
    const s = await setup();
    const a = await selfService(s, { firstName: "Ana", hireDate: "2026-01-05" });
    const b = await newEmp(s, { firstName: "Bob", hireDate: "2026-01-05" });
    const c = await newEmp(s, { firstName: "Cléo", hireDate: "2026-01-05" });
    const monday = "2026-09-14";
    await pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId: a.e.id, date: monday, status: "LATE", checkIn: "09:30", checkOut: "17:45" }));
    await pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId: a.e.id, date: monday, status: "PRESENT", checkIn: "08:00" })); // mise à jour, pas de doublon
    await expect(pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId: a.e.id, date: "2999-01-01", status: "PRESENT" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId: a.e.id, date: monday, status: "PRESENT", checkIn: "10:00", checkOut: "09:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(attendanceSchema.safeParse({ employeeId: a.e.id, date: monday, status: "PRESENT", checkIn: "25:99" }).success).toBe(false);
    await expect(pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId: a.e.id, date: "2019-12-30", status: "PRESENT" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // congé approuvé sur le jour de Cléo
    const type = await annual(s);
    const lr = await lv.requestLeave(s.ctx, leaveInput(c.id, type.id, monday, monday));
    expect(lr.status).toBe("APPROVED"); // administrateur unique : accepté d'office
    await expect(pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId: c.id, date: monday, status: "PRESENT" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("congé") });
    expect(await pp.markAllPresent(s.ctx, { date: monday })).toEqual({ marked: 1 }); // seulement Bob
    expect(await pp.markAllPresent(s.ctx, { date: monday })).toEqual({ marked: 0 });
    await expect(pp.markAllPresent(s.ctx, { date: "2026-09-13" })).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // dimanche
    const board = await pp.attendanceBoard(s.ctx, new Date(monday));
    expect(board.find((r) => r.name.includes("Cléo"))).toMatchObject({ status: null, onLeave: true });
    expect(board.find((r) => r.name.includes("Bob"))).toMatchObject({ status: "PRESENT", onLeave: false });
    expect(board.find((r) => r.employeeId === a.e.id)).toMatchObject({ status: "PRESENT", checkIn: "08:00" });
    const month = await pp.attendanceMonth(s.ctx, 2026, 9);
    expect(month.find((m) => m.employeeId === a.e.id)).toMatchObject({ present: 1, late: 0 });
    // sortie : plus de pointage
    await emp.terminateEmployee(s.ctx, { id: b.id, endDate: monday, reason: "" });
    await expect(pp.setAttendance(s.ctx, attendanceSchema.parse({ employeeId: b.id, date: monday, status: "PRESENT" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("évaluations (note 1 à 5) et formations", async () => {
    const s = await setup();
    const e = await newEmp(s, {});
    expect(evaluationSchema.safeParse({ employeeId: e.id, period: "2026-S1", date: today(), score: 6 }).success).toBe(false);
    const ev = await pp.createEvaluation(s.ctx, evaluationSchema.parse({ employeeId: e.id, period: "2026-S1", date: today(), score: 4, objectives: "Clôture mensuelle", comments: "Très bon semestre" }));
    expect(ev.evaluatorId).toBe(s.owner.id);
    const tr1 = await pp.createTraining(s.ctx, trainingSchema.parse({ employeeId: e.id, title: "Excel avancé", provider: "CFPA", date: today(), hours: 14, cost: 75000 }));
    expect(Number(tr1.cost)).toBe(75000);
    await pp.deleteEvaluation(s.ctx, ev.id);
    await pp.deleteTraining(s.ctx, tr1.id);
    await expect(pp.deleteTraining(s.ctx, tr1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
