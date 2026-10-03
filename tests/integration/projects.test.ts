import { describe, expect, it } from "vitest";
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
import * as pj from "@/modules/projects/service";
import { moveTaskSchema, projectSchema, taskSchema, timeSchema } from "@/modules/projects/schemas";
import * as bills from "@/modules/purchasing/bills";
import { supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import * as invoices from "@/modules/sales/invoices";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("PROJ", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Client Projet", paymentTermsDays: 30 }));
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  return { ...co, ctx, customer, tax };
}
type S = Awaited<ReturnType<typeof setup>>;

const newProject = (s: S, over: Record<string, unknown> = {}) => pj.createProject(s.ctx, projectSchema.parse({ name: "Chantier Riviera", status: "ACTIVE", customerId: s.customer.id, budget: 5_000_000, billRate: 25000, ...over }));
const newTask = (s: S, projectId: string, over: Record<string, unknown> = {}) => pj.createTask(s.ctx, taskSchema.parse({ projectId, title: "Fondations", ...over }));
const newEmp = (s: S, over: Record<string, unknown> = {}) => emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 352000, ...over }));
const log = (ctx: S["ctx"], projectId: string, employeeId: string, over: Record<string, unknown> = {}) => pj.logTime(ctx, timeSchema.parse({ projectId, employeeId, date: daysAgo(1), hours: 8, billable: true, ...over }));

/** Salarié lié à un utilisateur au rôle « Employé » (gestion de ses tâches et de son temps seulement). */
async function worker(s: S, over: Record<string, unknown> = {}) {
  const m = await addMember(s.company.id, "employee");
  const e = await newEmp(s, { userId: m.user.id, ...over });
  return { e, ctx: await ctxFor(m.user.id, s.company.id) };
}

describe("projets", () => {
  it("code PRJ-0001, références validées, dates cohérentes, clôture exigeant des tâches terminées", async () => {
    const s = await setup();
    const p = await newProject(s);
    expect(p.code).toBe("PRJ-0001");
    expect((await newProject(s, { name: "Deuxième" })).code).toBe("PRJ-0002");
    await expect(newProject(s, { startDate: "2026-06-01", endDate: "2026-05-01" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const t1 = await newTask(s, p.id);
    await newTask(s, p.id, { title: "Gros œuvre", status: "DONE" });
    await expect(pj.setProjectStatus(s.ctx, p.id, "DONE")).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("tâche") });
    await pj.moveTask(s.ctx, moveTaskSchema.parse({ id: t1.id, status: "DONE" }));
    await expect(pj.setProjectStatus(s.ctx, p.id, "DONE")).resolves.toMatchObject({ status: "DONE" });
    // projet terminé : planification figée jusqu'à réouverture
    await expect(newTask(s, p.id, { title: "Après coup" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await pj.setProjectStatus(s.ctx, p.id, "ACTIVE");
    await expect(newTask(s, p.id, { title: "Après coup" })).resolves.toBeTruthy();
    expect((await pj.listProjects(s.ctx, { q: "riviera", skip: 0, take: 10 })).total).toBe(1);
  });

  it("ISOLATION : client, chef de projet, agence ou centre de coûts d'une autre entreprise refusés", async () => {
    const A = await setup();
    const B = await setup();
    const eB = await newEmp(B, {});
    const brB = await org.createBranch(B.ctx, { name: "Agence B", code: "B1" } as never);
    await expect(newProject(A, { customerId: B.customer.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newProject(A, { managerId: eB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newProject(A, { branchId: brB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const pB = await newProject(B, {});
    await expect(pj.getProject(A.ctx, pB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pj.setProjectStatus(A.ctx, pB.id, "ON_HOLD")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pj.createTask(A.ctx, taskSchema.parse({ projectId: pB.id, title: "Intrusion" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pj.listProjects(A.ctx, { skip: 0, take: 10 })).total).toBe(0);
  });
});

describe("tâches", () => {
  it("dépendances sans boucle, même projet seulement ; déplacement Kanban ; suppression refusée si du temps est saisi", async () => {
    const s = await setup();
    const p = await newProject(s);
    const other = await newProject(s, { name: "Autre projet" });
    const a = await newTask(s, p.id, { title: "Tâche A" });
    const b = await newTask(s, p.id, { title: "Tâche B", dependsOnId: a.id });
    const c = await newTask(s, p.id, { title: "Tâche C", dependsOnId: b.id });
    await expect(pj.updateTask(s.ctx, { ...taskSchema.omit({ projectId: true }).parse({ title: "Tâche A", dependsOnId: c.id }), id: a.id })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("boucle") });
    await expect(pj.updateTask(s.ctx, { ...taskSchema.omit({ projectId: true }).parse({ title: "Tâche A", dependsOnId: a.id }), id: a.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const foreign = await newTask(s, other.id, { title: "Ailleurs" });
    await expect(newTask(s, p.id, { title: "Tâche X", dependsOnId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newTask(s, p.id, { title: "Tâche Y", startDate: "2026-05-10", dueDate: "2026-05-01" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const done = await pj.moveTask(s.ctx, moveTaskSchema.parse({ id: a.id, status: "DONE" }));
    expect(done.completedAt).not.toBeNull();
    const back = await pj.moveTask(s.ctx, moveTaskSchema.parse({ id: a.id, status: "IN_PROGRESS" }));
    expect(back.completedAt).toBeNull();
    const e = await newEmp(s, {});
    await log(s.ctx, p.id, e.id, { taskId: a.id });
    await expect(pj.deleteTask(s.ctx, a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await pj.deleteTask(s.ctx, c.id);
    expect((await pj.listTasks(s.ctx, p.id)).map((t) => t.title).sort()).toEqual(["Tâche A", "Tâche B"]);
  });

  it("un membre sans droit de gestion ne déplace que ses propres tâches", async () => {
    const s = await setup();
    const p = await newProject(s);
    const me = await worker(s, { firstName: "Moi" });
    const other = await newEmp(s, { firstName: "Autre" });
    const mine = await newTask(s, p.id, { title: "Ma tâche", assigneeId: me.e.id });
    const theirs = await newTask(s, p.id, { title: "Leur tâche", assigneeId: other.id });
    await expect(pj.moveTask(me.ctx, moveTaskSchema.parse({ id: mine.id, status: "IN_PROGRESS" }))).resolves.toMatchObject({ status: "IN_PROGRESS" });
    await expect(pj.moveTask(me.ctx, moveTaskSchema.parse({ id: theirs.id, status: "DONE" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pj.myTasks(me.ctx)).map((t) => t.title)).toEqual(["Ma tâche"]);
  });
});

describe("temps passé", () => {
  it("coût horaire figé (salaire ÷ 176 h), taux de facturation du projet, limites de saisie", async () => {
    const s = await setup();
    const p = await newProject(s);
    const e = await newEmp(s, { baseSalary: 352000 }); // 2 000 / h
    const t = await log(s.ctx, p.id, e.id, { hours: 6 });
    expect(Number(t.costRate)).toBe(2000);
    expect(Number(t.billRate)).toBe(25000);
    await expect(log(s.ctx, p.id, e.id, { hours: 19 })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("24 h") });
    await expect(log(s.ctx, p.id, e.id, { date: "2999-01-01" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(log(s.ctx, p.id, e.id, { date: "2019-12-30" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(timeSchema.safeParse({ projectId: p.id, employeeId: e.id, date: today(), hours: 25 }).success).toBe(false);
    // une hausse de salaire ne réécrit pas l'historique
    await emp.addContract(s.ctx, { employeeId: e.id, type: "PERMANENT", startDate: "2026-01-01", salary: 528000, notes: "" } as never);
    expect(Number((await s.ctx.db.timeEntry.findFirstOrThrow({ where: { id: t.id } })).costRate)).toBe(2000);
    expect(Number((await log(s.ctx, p.id, e.id, { date: daysAgo(2), hours: 1 })).costRate)).toBe(3000);
    // projet en pause : plus de saisie
    await pj.setProjectStatus(s.ctx, p.id, "ON_HOLD");
    await expect(log(s.ctx, p.id, e.id, { date: daysAgo(3) })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // temps non facturable : taux de facturation nul
    await pj.setProjectStatus(s.ctx, p.id, "ACTIVE");
    expect(Number((await log(s.ctx, p.id, e.id, { date: daysAgo(4), billable: false })).billRate)).toBe(0);
  });

  it("chacun saisit son propre temps ; la liste et les modifications sont limitées aux siennes", async () => {
    const s = await setup();
    const p = await newProject(s);
    const a = await worker(s, { firstName: "Ana" });
    const b = await worker(s, { firstName: "Bob" });
    await expect(log(a.ctx, p.id, b.e.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const mine = await log(a.ctx, p.id, a.e.id, { hours: 3 });
    const hisE = await log(b.ctx, p.id, b.e.id, { hours: 4 });
    expect((await pj.listTime(a.ctx, { skip: 0, take: 10 })).rows.map((r) => r.id)).toEqual([mine.id]);
    expect((await pj.listTime(s.ctx, { skip: 0, take: 10 })).total).toBe(2);
    await expect(pj.deleteTime(a.ctx, hisE.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pj.updateTime(a.ctx, { id: hisE.id, date: daysAgo(1), hours: 1, billable: true } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await pj.updateTime(a.ctx, { id: mine.id, date: daysAgo(1), hours: 5, billable: true } as never);
    expect(Number((await s.ctx.db.timeEntry.findFirstOrThrow({ where: { id: mine.id } })).hours)).toBe(5);
    await pj.deleteTime(a.ctx, mine.id);
    expect((await pj.listTime(s.ctx, { skip: 0, take: 10 })).total).toBe(1);
  });

  it("CONCURRENCE : 6 saisies simultanées de 5 h le même jour → jamais plus de 24 h", async () => {
    const s = await setup();
    const p = await newProject(s);
    const e = await newEmp(s, {});
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => log(s.ctx, p.id, e.id, { hours: 5 })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(4); // 4 × 5 h = 20 h ; la 5ᵉ ferait 25 h
    const agg = await s.ctx.db.timeEntry.aggregate({ where: { employeeId: e.id }, _sum: { hours: true } });
    expect(Number(agg._sum.hours)).toBe(20);
  });
});

describe("situation financière et facturation du temps", () => {
  it("coûts (temps, dépenses payées, achats validés), produits facturés, temps à facturer, marge et budget", async () => {
    const s = await setup();
    const p = await newProject(s, { budget: 1_000_000, billRate: 20000 });
    const e = await newEmp(s, { baseSalary: 352000 });
    await log(s.ctx, p.id, e.id, { hours: 8 }); // coût 16 000 ; à facturer 160 000
    await log(s.ctx, p.id, e.id, { date: daysAgo(2), hours: 4, billable: false }); // coût 8 000 ; non facturable

    // dépense payée rattachée (150 000) + dépense non payée (ignorée)
    const bank = (await tr.listAccounts(s.ctx)).find((a) => a.type === "BANK")!;
    const cat = (await tr.listCategories(s.ctx, { kind: "EXPENSE" }))[0]!;
    const e1 = await ex.createExpense(s.ctx, expenseSchema.parse({ date: today(), categoryId: cat.id, description: "Location de grue", amount: 150000, method: "BANK_TRANSFER", projectId: p.id }));
    await ex.submitExpense(s.ctx, e1.id);
    await ex.payExpense(s.ctx, { id: e1.id, accountId: bank.id, date: today(), method: "BANK_TRANSFER" } as never);
    await ex.createExpense(s.ctx, expenseSchema.parse({ date: today(), categoryId: cat.id, description: "Brouillon", amount: 999999, projectId: p.id }));
    // facture fournisseur validée (100 000 HT) rattachée
    const supplier = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: "Fournisseur Béton", paymentTermsDays: 30 }));
    const bill = await bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId: supplier.id, supplierRef: "B-1", billDate: today(), projectId: p.id, lines: [{ description: "Béton", quantity: 1, unitPrice: 100000, taxId: s.tax.id }] }));
    await bills.postBill(s.ctx, bill.id);
    // facture client émise rattachée (400 000 HT)
    const draft = await invoices.createInvoice(s.ctx, (await import("@/modules/sales/schemas")).invoiceSchema.parse({ customerId: s.customer.id, issueDate: today(), projectId: p.id, lines: [{ description: "Forfait", unit: "u", quantity: 1, unitPrice: 400000, discountPct: 0, taxId: s.tax.id }] }));
    await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });

    const sum = await pj.projectSummary(s.ctx, p.id);
    expect(sum.hours.toNumber()).toBe(12);
    expect(sum.billableHours.toNumber()).toBe(8);
    expect(sum.laborCost.toNumber()).toBe(24000);
    expect(sum.expensesCost.toNumber()).toBe(150000);
    expect(sum.billsCost.toNumber()).toBe(100000);
    expect(sum.totalCost.toNumber()).toBe(274000);
    expect(sum.budgetUsedPct).toBe(27.4);
    expect(sum.revenue.toNumber()).toBe(400000);
    expect(sum.toBill.toNumber()).toBe(160000);
    expect(sum.margin.toNumber()).toBe(126000);
    // un membre sans droit de lire les dépenses/factures ne voit que le temps
    const worker1 = await worker(s, {});
    const lim = await pj.projectSummary(worker1.ctx, p.id);
    expect(lim.expensesCost.toNumber()).toBe(0);
    expect(lim.revenue.toNumber()).toBe(0);
    expect(lim.laborCost.toNumber()).toBe(24000);
  });

  it("rattacher un projet inconnu ou annulé à un document est refusé", async () => {
    const s = await setup();
    const B = await setup();
    const pB = await newProject(B, {});
    const cat = (await tr.listCategories(s.ctx, { kind: "EXPENSE" }))[0]!;
    await expect(ex.createExpense(s.ctx, expenseSchema.parse({ date: today(), categoryId: cat.id, description: "Frais X", amount: 1000, projectId: pB.id }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const p = await newProject(s, {});
    await pj.setProjectStatus(s.ctx, p.id, "CANCELLED");
    await expect(ex.createExpense(s.ctx, expenseSchema.parse({ date: today(), categoryId: cat.id, description: "Frais X", amount: 1000, projectId: p.id }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("facturation du temps : brouillon groupé par salarié, saisies verrouillées, libérées à l'annulation ou à la suppression", async () => {
    const s = await setup();
    const p = await newProject(s, { billRate: 30000 });
    const a = await newEmp(s, { firstName: "Ana", lastName: "Aka" });
    const b = await newEmp(s, { firstName: "Bob", lastName: "Bamba" });
    const t1 = await log(s.ctx, p.id, a.id, { hours: 8, date: daysAgo(3) });
    await log(s.ctx, p.id, a.id, { hours: 4, date: daysAgo(2) });
    await log(s.ctx, p.id, b.id, { hours: 6, date: daysAgo(2) });
    await log(s.ctx, p.id, b.id, { hours: 2, date: daysAgo(1), billable: false });
    const inv = await pj.invoiceTime(s.ctx, { projectId: p.id });
    expect(inv.status).toBe("DRAFT");
    const full = await invoices.getInvoice(s.ctx, inv.id);
    expect(full.projectId).toBe(p.id);
    expect(full.lines.map((l) => [l.description.split(" — ")[1]!.split(" (")[0], Number(l.quantity), Number(l.unitPrice)])).toEqual([["Ana Aka", 12, 30000], ["Bob Bamba", 6, 30000]]);
    expect(Number(full.subtotal)).toBe(540000);
    // facturé : plus modifiable, plus refacturable
    await expect(pj.deleteTime(s.ctx, t1.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("facturé") });
    await expect(pj.invoiceTime(s.ctx, { projectId: p.id })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Aucun temps") });
    expect((await pj.projectSummary(s.ctx, p.id)).toBill.toNumber()).toBe(0);
    // facture émise puis annulée : le temps redevient facturable
    await invoices.issueInvoice(s.ctx, { id: inv.id, installments: 1, allowOverLimit: false });
    await invoices.cancelInvoice(s.ctx, inv.id);
    expect((await pj.projectSummary(s.ctx, p.id)).toBill.toNumber()).toBe(540000);
    const again = await pj.invoiceTime(s.ctx, { projectId: p.id, entryIds: [t1.id] });
    expect(Number((await invoices.getInvoice(s.ctx, again.id)).subtotal)).toBe(240000);
    // suppression du brouillon : libère les saisies
    await invoices.deleteInvoice(s.ctx, again.id);
    expect((await pj.projectSummary(s.ctx, p.id)).toBill.toNumber()).toBe(540000);
    // saisie inconnue
    await expect(pj.invoiceTime(s.ctx, { projectId: p.id, entryIds: [crypto.randomUUID()] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("garde-fous : client et taux obligatoires, droit de facturer requis, isolation", async () => {
    const s = await setup();
    const noClient = await newProject(s, { customerId: "", name: "Interne" });
    const e = await newEmp(s, {});
    await log(s.ctx, noClient.id, e.id);
    await expect(pj.invoiceTime(s.ctx, { projectId: noClient.id })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("client") });
    const noRate = await newProject(s, { billRate: 0, name: "Sans taux" });
    await log(s.ctx, noRate.id, e.id, { date: daysAgo(2) });
    await expect(pj.invoiceTime(s.ctx, { projectId: noRate.id })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("taux") });
    const p = await newProject(s, {});
    await log(s.ctx, p.id, e.id, { date: daysAgo(3) });
    const w = await worker(s, {});
    await expect(pj.invoiceTime(w.ctx, { projectId: p.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const B = await setup();
    await expect(pj.invoiceTime(B.ctx, { projectId: p.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(log(B.ctx, p.id, e.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pj.listTime(B.ctx, { skip: 0, take: 10 })).total).toBe(0);
  });
});
