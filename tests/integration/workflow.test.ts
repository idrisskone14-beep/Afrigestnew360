import { describe, expect, it } from "vitest";
import { canDecideRequest, decideApproval, listApprovals, pendingDecisionCount, pickRule, requiresApproval, resolveFlow, savePolicy } from "@/core/approvals";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import * as ex from "@/modules/finance/expenses";
import { expenseSchema } from "@/modules/finance/schemas";
import * as tr from "@/modules/finance/treasury";
import * as emp from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import * as org from "@/modules/org/service";
import { departmentSchema } from "@/modules/org/schemas";
import * as bills from "@/modules/purchasing/bills";
import { supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import * as invoices from "@/modules/sales/invoices";
import { invoiceSchema } from "@/modules/sales/schemas";
import { deleteRole } from "@/modules/settings/roles";
import { ruleSchema } from "@/modules/workflow/schemas";
import * as wf from "@/modules/workflow/service";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("WF", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const role = async (key: string) => (await platformDb.role.findFirstOrThrow({ where: { companyId: co.company.id, templateKey: key } })).id;
  const member = async (key: string) => { const m = await addMember(co.company.id, key); return { ...m, ctx: await ctxFor(m.user.id, co.company.id) }; };
  const expCat = (await tr.listCategories(ctx, { kind: "EXPENSE" }))[0]!;
  return { ...co, ctx, role, member, expCat };
}
type S = Awaited<ReturnType<typeof setup>>;

const rule = (over: Record<string, unknown> = {}) => ruleSchema.parse({ resourceType: "expense", name: "Dépenses importantes", minAmount: 100000, steps: [{ label: "Manager", roleId: "" }], ...over });
const expense = (s: S, ctx: S["ctx"], amount: number) => ex.createExpense(ctx, expenseSchema.parse({ date: today(), categoryId: s.expCat.id, description: "Achat de matériel", amount, method: "CASH" }));

/** Chaîne Manager (Responsable commercial) → Directeur financier. */
async function twoStepRule(s: S, over: Record<string, unknown> = {}) {
  return wf.createRule(s.ctx, rule({ steps: [{ label: "Manager", roleId: await s.role("sales_manager") }, { label: "Directeur financier", roleId: await s.role("cfo") }], ...over }));
}
const pendingFor = (s: S, resourceId: string) => s.ctx.db.approvalRequest.findFirstOrThrow({ where: { resourceId }, include: { decisions: true } });

describe("choix de la règle (pur)", () => {
  const step = [{ stepOrder: 1, label: "A", roleId: "r" }];
  const base = { minAmount: 0, maxAmount: null, departmentId: null, requesterRoleId: null, priority: 100, steps: step };
  const R = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, ...base, ...over }) as Parameters<typeof pickRule>[0][number];
  const q = (amount: number, dept: string | null = null, role: string | null = null) => ({ amount, departmentId: dept, roleId: role });

  it("montant : minimum inclus, maximum exclu", () => {
    const rules = [R("petit", { minAmount: 0, maxAmount: 1000 }), R("grand", { minAmount: 1000 })];
    expect(pickRule(rules, q(999))?.id).toBe("petit");
    expect(pickRule(rules, q(1000))?.id).toBe("grand");
    expect(pickRule([R("x", { minAmount: 500 })], q(499))).toBeNull();
  });

  it("département et rôle du demandeur ; la règle la plus prioritaire puis la plus spécifique l'emporte", () => {
    const general = R("general"), dept = R("dept", { departmentId: "D1" }), both = R("both", { departmentId: "D1", requesterRoleId: "R1" });
    expect(pickRule([general, dept, both], q(10, "D2", null))?.id).toBe("general");
    expect(pickRule([general, dept], q(10, "D1", null))?.id).toBe("dept"); // plus spécifique
    expect(pickRule([general, dept, both], q(10, "D1", "R1"))?.id).toBe("both");
    expect(pickRule([general, dept, both], q(10, "D1", "R2"))?.id).toBe("dept");
    expect(pickRule([R("a", { priority: 50, departmentId: "D1" }), R("b", { priority: 200 })], q(10, "D1"))?.id).toBe("b"); // priorité avant spécificité
    expect(pickRule([R("vide", { steps: [] })], q(10))).toBeNull(); // une règle sans étape est ignorée
  });
});

describe("règles de validation : gestion", () => {
  it("création, validations (rôle sans droit, limites, références) et traces d'audit", async () => {
    const s = await setup();
    const r = await twoStepRule(s);
    const list = await wf.listRules(s.ctx);
    expect(list).toHaveLength(1);
    expect(list[0]!.steps.map((x) => x.stepOrder)).toEqual([1, 2]);
    // le rôle « Employé » n'a pas le droit de valider : étape refusée
    await expect(wf.createRule(s.ctx, rule({ steps: [{ label: "Employé", roleId: await s.role("employee") }] }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("ne peut pas valider") });
    await expect(wf.createRule(s.ctx, rule({ maxAmount: 50000, steps: [{ label: "Mgr", roleId: await s.role("cfo") }] }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(wf.createRule(s.ctx, rule({ departmentId: "00000000-0000-4000-8000-000000000000", steps: [{ label: "Mgr", roleId: await s.role("cfo") }] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ruleSchema.safeParse({ resourceType: "expense", name: "Sans étape", steps: [] }).success).toBe(false);
    expect(await s.ctx.db.auditLog.count({ where: { action: "approval.rule_create", resourceId: r.id } })).toBe(1);
    // un rôle utilisé par une règle ne peut pas être supprimé
    const custom = await platformDb.role.create({ data: { companyId: s.company.id, name: "Contrôleur" } });
    await platformDb.rolePermission.create({ data: { companyId: s.company.id, roleId: custom.id, permissionId: (await platformDb.permission.findFirstOrThrow({ where: { key: "workflow.request.approve" } })).id } });
    await wf.createRule(s.ctx, rule({ name: "Contrôle", steps: [{ label: "Contrôle", roleId: custom.id }] }));
    await expect(deleteRole(s.ctx, custom.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("règle de validation") });
  });

  it("isolation : une entreprise ne voit ni ne modifie les règles d'une autre", async () => {
    const a = await setup();
    const b = await setup();
    const r = await twoStepRule(a);
    expect(await wf.listRules(b.ctx)).toHaveLength(0);
    await expect(wf.updateRule(b.ctx, { id: r.id, ...rule({ steps: [{ label: "Étape", roleId: await b.role("cfo") }] }) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(wf.toggleRule(b.ctx, r.id, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(wf.deleteRule(b.ctx, r.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // et ne peut pas utiliser un rôle de l'autre entreprise comme étape
    await expect(wf.createRule(b.ctx, rule({ steps: [{ label: "Étape", roleId: await a.role("cfo") }] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await wf.listRules(a.ctx)).toHaveLength(1);
  });
});

describe("chaîne à deux étapes : Manager → Directeur financier", () => {
  it("chaque étape est décidée par son rôle ; la ressource n'est appliquée qu'à la dernière", async () => {
    const s = await setup();
    await twoStepRule(s);
    const requester = await s.member("accountant");
    const manager = await s.member("sales_manager");
    const cfo = await s.member("cfo");
    const e = await expense(s, requester.ctx, 150000);
    expect(await ex.submitExpense(requester.ctx, e.id)).toEqual({ needsApproval: true });
    const req = await pendingFor(s, e.id);
    expect(req).toMatchObject({ status: "PENDING", currentStep: 1, totalSteps: 2, currentLabel: "Manager" });

    // seul le Manager est prévenu, et seul lui peut décider de l'étape 1
    const notified = async (type: string) => (await platformDb.notification.findMany({ where: { companyId: s.company.id, type } })).map((n) => n.userId);
    expect(await notified("approval.pending")).toEqual(expect.arrayContaining([manager.user.id]));
    expect(await notified("approval.pending")).not.toContain(cfo.user.id);
    expect(await pendingDecisionCount(manager.ctx)).toBe(1);
    expect(await pendingDecisionCount(cfo.ctx)).toBe(0);
    await expect(decideApproval(cfo.ctx, { id: req.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideApproval(requester.ctx, { id: req.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // jamais sa propre demande

    expect(await decideApproval(manager.ctx, { id: req.id, decision: "APPROVED", comment: "OK pour moi" })).toEqual({ final: false });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("PENDING_APPROVAL"); // pas encore appliquée
    expect(await pendingFor(s, e.id)).toMatchObject({ status: "PENDING", currentStep: 2, currentLabel: "Directeur financier" });
    expect(await notified("approval.pending")).toContain(cfo.user.id);
    expect(await pendingDecisionCount(manager.ctx)).toBe(0);
    expect(await pendingDecisionCount(cfo.ctx)).toBe(1);
    await expect(decideApproval(manager.ctx, { id: req.id, decision: "APPROVED" })).rejects.toMatchObject({ code: expect.stringMatching(/BUSINESS_RULE|FORBIDDEN/) });

    expect(await decideApproval(cfo.ctx, { id: req.id, decision: "APPROVED" })).toEqual({ final: true });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("APPROVED");
    const done = await pendingFor(s, e.id);
    expect(done).toMatchObject({ status: "APPROVED", decidedById: cfo.user.id });
    expect(done.decisions.map((d) => [d.step, d.decidedById, d.decision])).toEqual(expect.arrayContaining([[1, manager.user.id, "APPROVED"], [2, cfo.user.id, "APPROVED"]]));
    expect(await platformDb.notification.count({ where: { companyId: s.company.id, userId: requester.user.id, type: "approval.decided" } })).toBe(1);
    await expect(decideApproval(cfo.ctx, { id: req.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // déjà traitée
  });

  it("un refus à n'importe quelle étape clôt la demande (motif obligatoire)", async () => {
    const s = await setup();
    await twoStepRule(s);
    const requester = await s.member("accountant"), manager = await s.member("sales_manager"), cfo = await s.member("cfo");
    const e = await expense(s, requester.ctx, 200000);
    await ex.submitExpense(requester.ctx, e.id);
    const req = await pendingFor(s, e.id);
    await decideApproval(manager.ctx, { id: req.id, decision: "APPROVED" });
    await expect(decideApproval(cfo.ctx, { id: req.id, decision: "REJECTED" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("motif") });
    expect(await decideApproval(cfo.ctx, { id: req.id, decision: "REJECTED", comment: "Hors budget" })).toEqual({ final: true });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("REJECTED");
    expect((await pendingFor(s, e.id)).decisions.map((d) => d.decision)).toEqual(["APPROVED", "REJECTED"]);
  });

  it("séparation des tâches : un administrateur peut décider d'une étape, mais pas de deux", async () => {
    const s = await setup();
    await twoStepRule(s);
    const requester = await s.member("accountant"), cfo = await s.member("cfo");
    const e = await expense(s, requester.ctx, 150000);
    await ex.submitExpense(requester.ctx, e.id);
    const req = await pendingFor(s, e.id);
    await decideApproval(s.ctx, { id: req.id, decision: "APPROVED" }); // l'admin (propriétaire) valide l'étape 1
    await expect(decideApproval(s.ctx, { id: req.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("déjà décidé") });
    await decideApproval(cfo.ctx, { id: req.id, decision: "APPROVED" });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("APPROVED");
  });

  it("concurrence : deux validateurs de la même étape en même temps → une seule décision enregistrée", async () => {
    const s = await setup();
    await twoStepRule(s);
    const requester = await s.member("accountant"), m1 = await s.member("sales_manager"), m2 = await s.member("sales_manager");
    const e = await expense(s, requester.ctx, 150000);
    await ex.submitExpense(requester.ctx, e.id);
    const req = await pendingFor(s, e.id);
    const results = await Promise.allSettled([decideApproval(m1.ctx, { id: req.id, decision: "APPROVED" }), decideApproval(m2.ctx, { id: req.id, decision: "APPROVED" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await pendingFor(s, e.id);
    expect(after.decisions).toHaveLength(1);
    expect(after).toMatchObject({ status: "PENDING", currentStep: 2 });
  });

  it("le journal des décisions est en écriture seule", async () => {
    const s = await setup();
    await twoStepRule(s);
    const requester = await s.member("accountant"), manager = await s.member("sales_manager");
    const e = await expense(s, requester.ctx, 150000);
    await ex.submitExpense(requester.ctx, e.id);
    await decideApproval(manager.ctx, { id: (await pendingFor(s, e.id)).id, decision: "APPROVED" });
    await expect(s.ctx.tx((tx) => tx.$executeRaw`UPDATE "ApprovalDecision" SET "comment" = 'falsifié'`)).rejects.toThrow();
    await expect(s.ctx.tx((tx) => tx.$executeRaw`DELETE FROM "ApprovalDecision"`)).rejects.toThrow();
  });

  it("une demande en cours garde sa chaîne : étapes verrouillées, suppression refusée, désactivation sans effet sur elle", async () => {
    const s = await setup();
    const r = await twoStepRule(s);
    const requester = await s.member("accountant"), manager = await s.member("sales_manager"), cfo = await s.member("cfo");
    const e = await expense(s, requester.ctx, 150000);
    await ex.submitExpense(requester.ctx, e.id);
    const one = [{ label: "Seul", roleId: await s.role("cfo") }];
    await expect(wf.updateRule(s.ctx, { id: r.id, ...rule({ steps: one }) })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("demandes") });
    await expect(wf.deleteRule(s.ctx, r.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // on peut renommer / ajuster les conditions sans toucher aux étapes, et désactiver
    const steps = (await wf.listRules(s.ctx))[0]!.steps.map((x) => ({ label: x.label, roleId: x.roleId }));
    await wf.updateRule(s.ctx, { id: r.id, ...rule({ name: "Renommée", minAmount: 90000, steps }) });
    await wf.toggleRule(s.ctx, r.id, false);
    const req = await pendingFor(s, e.id);
    await decideApproval(manager.ctx, { id: req.id, decision: "APPROVED" });
    await decideApproval(cfo.ctx, { id: req.id, decision: "APPROVED" });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("APPROVED");
    await wf.deleteRule(s.ctx, r.id); // plus aucune demande en cours : suppression possible
    expect(await wf.listRules(s.ctx)).toHaveLength(0);
  });
});

describe("conditions et repli sur la politique simple", () => {
  it("sous le minimum de la règle : politique simple (ou rien) ; au-delà : la chaîne", async () => {
    const s = await setup();
    await twoStepRule(s, { minAmount: 100000 });
    const requester = await s.member("accountant");
    expect(await requiresApproval(requester.ctx, "expense", 99999)).toBe(false); // ni règle ni seuil
    await savePolicy(s.ctx, { type: "expense", isEnabled: true, threshold: 50000 });
    const small = await resolveFlow(requester.ctx.db, requester.ctx, "expense", 60000);
    expect(small).toMatchObject({ required: true, ruleId: null, steps: [{ order: 1, roleId: null }] }); // politique simple : 1 étape par permission
    const big = await resolveFlow(requester.ctx.db, requester.ctx, "expense", 150000);
    expect(big.ruleId).not.toBeNull();
    expect(big.steps.map((x) => x.label)).toEqual(["Manager", "Directeur financier"]);
    // règle désactivée : retour à la politique simple
    await wf.toggleRule(s.ctx, big.ruleId!, false);
    expect((await resolveFlow(requester.ctx.db, requester.ctx, "expense", 150000)).ruleId).toBeNull();
    // politique simple : validée par une personne habilitée comme avant
    const e = await expense(s, requester.ctx, 60000);
    await ex.submitExpense(requester.ctx, e.id);
    const approver = await s.member("cfo");
    await decideApproval(approver.ctx, { id: (await pendingFor(s, e.id)).id, decision: "APPROVED" });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("APPROVED");
  });

  it("condition de département et de rôle du demandeur", async () => {
    const s = await setup();
    const sales = await org.createDepartment(s.ctx, departmentSchema.parse({ name: "Commercial" }));
    const ops = await org.createDepartment(s.ctx, departmentSchema.parse({ name: "Opérations" }));
    const worker = await s.member("accountant");
    await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000, userId: worker.user.id, departmentId: sales.id }));
    await twoStepRule(s, { name: "Opérations", departmentId: ops.id });
    expect((await resolveFlow(worker.ctx.db, worker.ctx, "expense", 150000)).required).toBe(false); // son département est « Commercial »
    await twoStepRule(s, { name: "Commercial", departmentId: sales.id });
    expect((await resolveFlow(worker.ctx.db, worker.ctx, "expense", 150000)).ruleId).not.toBeNull();
    // règle réservée à un autre rôle de demandeur : sans effet pour l'accountant
    await twoStepRule(s, { name: "Pour les managers", requesterRoleId: await s.role("sales_manager"), priority: 500 });
    const flow = await resolveFlow(worker.ctx.db, worker.ctx, "expense", 150000);
    expect((await wf.listRules(s.ctx)).find((r) => r.id === flow.ruleId)?.name).toBe("Commercial");
    // la liste des demandes expose l'étape courante et l'historique
    const e = await expense(s, worker.ctx, 150000);
    await ex.submitExpense(worker.ctx, e.id);
    const rows = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows;
    expect(rows[0]).toMatchObject({ currentStep: 1, totalSteps: 2, rule: { name: "Commercial" } });
    const manager = await s.member("sales_manager");
    expect(canDecideRequest(manager.ctx, rows[0]!)).toBe(true);
    expect(canDecideRequest(worker.ctx, rows[0]!)).toBe(false);
    expect(canDecideRequest((await s.member("viewer")).ctx, rows[0]!)).toBe(false);
  });
});

describe("paiements fournisseurs soumis à validation", () => {
  async function bill(s: S, total = 1_000_000) {
    const supplier = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: `Fournisseur ${Math.random().toString(36).slice(2, 7)}`, paymentTermsDays: 30 }));
    const draft = await bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId: supplier.id, supplierRef: `F-${Math.random().toString(36).slice(2, 7)}`, billDate: today(), lines: [{ description: "Service", quantity: 1, unitPrice: total, taxId: "" }] } as never));
    return bills.postBill(s.ctx, draft.id);
  }
  const pay = (ctx: S["ctx"], billId: string, amount: number) => bills.recordSupplierPayment(ctx, { billId, amount, method: "BANK_TRANSFER", date: today() } as never);

  it("au-dessus du seuil : aucun effet avant décision ; approbation = paiement appliqué ; refus = annulé", async () => {
    const s = await setup();
    await savePolicy(s.ctx, { type: "supplier_payment", isEnabled: true, threshold: 300000 });
    const accountant = await s.member("accountant");
    const approver = await s.member("cfo");
    const b = await bill(s);
    const small = await pay(accountant.ctx, b.id, 100000); // sous le seuil : immédiat
    expect(small.status).toBe("VALIDATED");
    const big = await pay(accountant.ctx, b.id, 400000);
    expect(big.status).toBe("PENDING");
    expect(Number((await bills.getBill(s.ctx, b.id)).amountPaid)).toBe(100000); // dette inchangée par la demande
    // les paiements en attente comptent dans le reste à payer : 1 000 000 − 100 000 − 400 000 = 500 000
    await expect(pay(accountant.ctx, b.id, 600000)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("en attente") });
    const req = await pendingFor(s, big.id);
    expect(req).toMatchObject({ resourceType: "supplier_payment", status: "PENDING" });
    await expect(decideApproval(accountant.ctx, { id: req.id, decision: "APPROVED" })).rejects.toMatchObject({ code: expect.stringMatching(/BUSINESS_RULE|FORBIDDEN/) });
    await decideApproval(approver.ctx, { id: req.id, decision: "APPROVED" });
    const paid = await bills.getBill(s.ctx, b.id);
    expect(Number(paid.amountPaid)).toBe(500000);
    expect((await s.ctx.db.payment.findFirstOrThrow({ where: { id: big.id } })).status).toBe("VALIDATED");
    // refus
    const second = await pay(accountant.ctx, b.id, 350000);
    await decideApproval(approver.ctx, { id: (await pendingFor(s, second.id)).id, decision: "REJECTED", comment: "Contestation de la facture" });
    expect((await s.ctx.db.payment.findFirstOrThrow({ where: { id: second.id } })).status).toBe("CANCELLED");
    expect(Number((await bills.getBill(s.ctx, b.id)).amountPaid)).toBe(500000);
    // annulation d'un paiement en attente : sans effet financier, demande retirée
    const third = await pay(accountant.ctx, b.id, 320000);
    await bills.cancelSupplierPayment(accountant.ctx, third.id);
    expect((await s.ctx.db.payment.findFirstOrThrow({ where: { id: third.id } })).status).toBe("CANCELLED");
    expect((await pendingFor(s, third.id)).status).toBe("CANCELLED");
    expect(Number((await bills.getBill(s.ctx, b.id)).amountPaid)).toBe(500000);
  });
});

describe("remises commerciales soumises à validation", () => {
  async function discounted(s: S, pct: number) {
    const customer = await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Client Remise", paymentTermsDays: 30 }));
    const draft = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: today(), lines: [{ description: "Prestation", unit: "forfait", quantity: 10, unitPrice: 10000, discountPct: pct }] } as never));
    return draft;
  }
  const issue = (ctx: S["ctx"], id: string) => invoices.issueInvoice(ctx, { id, installments: 1, allowOverLimit: false });

  it("l'émission attend la validation ; une remise modifiée exige une nouvelle validation", async () => {
    const s = await setup();
    await savePolicy(s.ctx, { type: "discount", isEnabled: true, threshold: 5000 });
    const seller = await s.member("sales_rep");
    const manager = await s.member("sales_manager");
    const small = await discounted(s, 2); // 2 000 de remise : sous le seuil
    expect((await issue(s.ctx, small.id)).status).toBe("ISSUED");

    const d1 = await discounted(s, 10); // 10 000 de remise
    await expect(issue(s.ctx, d1.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("doit être validée") });
    const req = await pendingFor(s, d1.id);
    expect(req).toMatchObject({ resourceType: "discount", status: "PENDING", requestedById: s.owner.id });
    await expect(issue(s.ctx, d1.id)).rejects.toMatchObject({ message: expect.stringContaining("en attente") });
    expect(await s.ctx.db.approvalRequest.count({ where: { resourceId: d1.id } })).toBe(1); // pas de doublon de demande
    await expect(decideApproval(seller.ctx, { id: req.id, decision: "APPROVED" })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|BUSINESS_RULE/) });
    await decideApproval(manager.ctx, { id: req.id, decision: "APPROVED" });
    expect((await issue(s.ctx, d1.id)).status).toBe("ISSUED");

    // remise refusée : on ne peut pas réémettre telle quelle ; modifiée, elle repart en validation
    const d2 = await discounted(s, 10);
    await expect(issue(s.ctx, d2.id)).rejects.toBeTruthy();
    await decideApproval(manager.ctx, { id: (await pendingFor(s, d2.id)).id, decision: "REJECTED", comment: "Trop élevée" });
    await expect(issue(s.ctx, d2.id)).rejects.toMatchObject({ message: expect.stringContaining("refusée") });
    await invoices.updateInvoice(s.ctx, { id: d2.id, customerId: d2.customerId, issueDate: today(), lines: [{ description: "Prestation", unit: "forfait", quantity: 10, unitPrice: 10000, discountPct: 8 }] } as never);
    await expect(issue(s.ctx, d2.id)).rejects.toMatchObject({ message: expect.stringContaining("doit être validée") });
    expect(await s.ctx.db.approvalRequest.count({ where: { resourceId: d2.id } })).toBe(2);
  });
});
