import { describe, expect, it } from "vitest";
import { decideApproval, listApprovals, savePolicy } from "@/core/approvals";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { setCompanyModule } from "@/modules/platform/companies";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import * as ex from "@/modules/finance/expenses";
import * as rp from "@/modules/finance/reports";
import { budgetSchema, expenseSchema, manualTransactionSchema, transferSchema } from "@/modules/finance/schemas";
import * as tr from "@/modules/finance/treasury";
import * as bills from "@/modules/purchasing/bills";
import { supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import * as invoices from "@/modules/sales/invoices";
import * as payments from "@/modules/sales/payments";
import { invoiceSchema } from "@/modules/sales/schemas";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("FINANCE", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const other = await addMember(co.company.id, "admin");
  const requester = await ctxFor(other.user.id, co.company.id);
  const accounts = await tr.listAccounts(ctx);
  const cash = accounts.find((a) => a.type === "CASH")!;
  const bank = accounts.find((a) => a.type === "BANK")!;
  const expCat = (await tr.listCategories(ctx, { kind: "EXPENSE" }))[0]!;
  const incCat = (await tr.listCategories(ctx, { kind: "INCOME" }))[0]!;
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const balance = async (id: string) => (await tr.getAccount(ctx, id)).balance.toNumber();
  return { ...co, ctx, other, requester, cash, bank, expCat, incCat, tax, balance };
}
type S = Awaited<ReturnType<typeof setup>>;

const income = (s: S, accountId: string, amount: number, over = {}) => tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId, type: "IN", date: today(), amount, description: "Apport de démarrage", ...over }));
const expense = (s: S, amount = 50000, over = {}) => ex.createExpense(s.ctx, expenseSchema.parse({ date: today(), categoryId: s.expCat.id, description: "Facture d'électricité", amount, method: "CASH", ...over }));

/** Facture émise de `qty × 10 000` HT (+18 %) pour un client neuf. */
async function issuedInvoice(s: S, qty = 10) {
  const customer = await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: `Client ${Math.random().toString(36).slice(2, 7)}`, paymentTermsDays: 30 }));
  const draft = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: today(), lines: [{ description: "Prestation", unit: "forfait", quantity: qty, unitPrice: 10000, discountPct: 0, taxId: s.tax.id }] }));
  return invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
}

async function postedBill(s: S, total = 100000, over: { dueDate?: string } = {}) {
  const supplier = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: `Fournisseur ${Math.random().toString(36).slice(2, 7)}`, paymentTermsDays: 30 }));
  const draft = await bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId: supplier.id, supplierRef: `F-${Math.random().toString(36).slice(2, 7)}`, billDate: today(), dueDate: over.dueDate ?? "", lines: [{ description: "Service", quantity: 1, unitPrice: total / 1.18, taxId: s.tax.id }] }));
  return bills.postBill(s.ctx, draft.id);
}

describe("comptes et catégories par défaut", () => {
  it("crée une caisse et une banque par défaut, des catégories, à solde nul", async () => {
    const s = await setup();
    expect(s.cash).toMatchObject({ name: "Caisse principale", isDefault: true });
    expect(s.bank).toMatchObject({ name: "Banque principale", isDefault: true });
    expect(s.cash.balance.toNumber()).toBe(0);
    expect((await tr.listCategories(s.ctx, { kind: "EXPENSE" })).length).toBeGreaterThan(5);
    expect(s.cash.currency).toBe(s.company.currency);
  });

  it("création, nom unique, un seul compte par défaut par type, solde d'ouverture figé après mouvements", async () => {
    const s = await setup();
    const acc = await tr.createAccount(s.ctx, { name: "Orange Money", type: "MOBILE_MONEY", openingBalance: 25000, isDefault: false } as never);
    expect(acc.isDefault).toBe(true); // premier du type
    expect((await tr.getAccount(s.ctx, acc.id)).balance.toNumber()).toBe(25000);
    await expect(tr.createAccount(s.ctx, { name: "Orange Money", type: "MOBILE_MONEY", openingBalance: 0, isDefault: false } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const bank2 = await tr.createAccount(s.ctx, { name: "Ecobank", type: "BANK", openingBalance: 0, isDefault: true } as never);
    const banks = (await tr.listAccounts(s.ctx)).filter((a) => a.type === "BANK");
    expect(banks.filter((b) => b.isDefault).map((b) => b.id)).toEqual([bank2.id]);
    await income(s, acc.id, 1000);
    await expect(tr.updateAccount(s.ctx, { id: acc.id, name: "Orange Money", type: "MOBILE_MONEY", openingBalance: 5, isDefault: true, isActive: true } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(tr.updateAccount(s.ctx, { id: acc.id, name: "Orange Money", type: "MOBILE_MONEY", openingBalance: 25000, isDefault: true, isActive: false } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("solde") });
  });
});

describe("mouvements de trésorerie", () => {
  it("saisie manuelle, soldes, contrôle de catégorie, caisse jamais négative, banque à découvert possible", async () => {
    const s = await setup();
    await income(s, s.cash.id, 100000, { categoryId: s.incCat.id });
    expect(await s.balance(s.cash.id)).toBe(100000);
    await expect(income(s, s.cash.id, 1, { categoryId: s.expCat.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const out = (amount: number, accountId: string) => tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId, type: "OUT", date: today(), amount, description: "Achat divers" }));
    await expect(out(150000, s.cash.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Solde insuffisant") });
    expect(await s.balance(s.cash.id)).toBe(100000);
    await out(60000, s.cash.id);
    expect(await s.balance(s.cash.id)).toBe(40000);
    await out(500000, s.bank.id); // découvert autorisé sur un compte bancaire
    expect(await s.balance(s.bank.id)).toBe(-500000);
  });

  it("transfert entre comptes : deux écritures liées, solde vérifié, annulation des deux jambes", async () => {
    const s = await setup();
    await income(s, s.bank.id, 300000);
    const tf = (amount: number, from = s.bank.id, to = s.cash.id) => tr.createTransfer(s.ctx, transferSchema.parse({ fromAccountId: from, toAccountId: to, amount, date: today() }));
    await tf(120000);
    expect(await s.balance(s.bank.id)).toBe(180000);
    expect(await s.balance(s.cash.id)).toBe(120000);
    await expect(tf(10, s.bank.id, s.bank.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(tf(500000, s.cash.id, s.bank.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // caisse insuffisante
    expect(await s.balance(s.bank.id)).toBe(180000);
    const leg = (await tr.listTransactions(s.ctx, { type: "TRANSFER_OUT", skip: 0, take: 5 })).rows[0]!;
    await tr.cancelTransaction(s.ctx, leg.id);
    expect(await s.balance(s.bank.id)).toBe(300000);
    expect(await s.balance(s.cash.id)).toBe(0);
  });

  it("annuler une entrée qui rendrait la caisse négative est refusé ; rapprochement bancaire", async () => {
    const s = await setup();
    const t = await income(s, s.cash.id, 50000);
    await expect(tr.cancelTransaction(s.ctx, t.id)).resolves.toBeUndefined();
    const t2 = await income(s, s.cash.id, 50000);
    await tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId: s.cash.id, type: "OUT", date: today(), amount: 30000, description: "Dépense" }));
    await expect(tr.cancelTransaction(s.ctx, t2.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await tr.setReconciled(s.ctx, t2.id, true);
    await expect(tr.cancelTransaction(s.ctx, t2.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await tr.setReconciled(s.ctx, t2.id, false);
  });
});

describe("encaissements et règlements fournisseurs → trésorerie", () => {
  it("un paiement client validé crée l'entrée sur le compte du mode de paiement ; son annulation la retire", async () => {
    const s = await setup();
    const inv = await issuedInvoice(s); // 118 000 TTC
    const p1 = await payments.recordPayment(s.ctx, { invoiceId: inv.id, amount: 70000, method: "BANK_TRANSFER", date: today(), reference: "VIR-1" } as never);
    const p2 = await payments.recordPayment(s.ctx, { invoiceId: inv.id, amount: 18000, method: "CASH", date: today() } as never);
    expect(await s.balance(s.bank.id)).toBe(70000);
    expect(await s.balance(s.cash.id)).toBe(18000);
    expect((await ctxPayment(s, p1.id)).accountId).toBe(s.bank.id);
    await payments.cancelPayment(s.ctx, p2.id);
    expect(await s.balance(s.cash.id)).toBe(0);
    const row = (await tr.listTransactions(s.ctx, { includeCancelled: true, skip: 0, take: 10 })).rows.find((r) => r.sourceId === p2.id)!;
    expect(row.status).toBe("CANCELLED");
    // un mouvement issu d'un paiement ne s'annule pas à la main
    const live = (await tr.listTransactions(s.ctx, { skip: 0, take: 10 })).rows.find((r) => r.sourceId === p1.id)!;
    await expect(tr.cancelTransaction(s.ctx, live.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("règlement fournisseur : sortie de trésorerie ; fonds insuffisants en caisse → le paiement est refusé en entier", async () => {
    const s = await setup();
    const bill = await postedBill(s, 100000);
    await expect(bills.recordSupplierPayment(s.ctx, { billId: bill.id, amount: 100000, method: "CASH", date: today() } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Solde insuffisant") });
    const b = await bills.getBill(s.ctx, bill.id);
    expect(Number(b.amountPaid)).toBe(0);
    expect(b.payments).toHaveLength(0);
    await income(s, s.cash.id, 100000);
    const p = await bills.recordSupplierPayment(s.ctx, { billId: bill.id, amount: 100000, method: "CASH", date: today() } as never);
    expect(await s.balance(s.cash.id)).toBe(0);
    await bills.cancelSupplierPayment(s.ctx, p.id);
    expect(await s.balance(s.cash.id)).toBe(100000);
  });

  it("le compte choisi doit appartenir à l'entreprise ; module Finance inactif → aucun mouvement", async () => {
    const A = await setup();
    const B = await setup();
    const inv = await issuedInvoice(A);
    await expect(payments.recordPayment(A.ctx, { invoiceId: inv.id, amount: 1000, method: "BANK_TRANSFER", date: today(), accountId: B.bank.id } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const bill = await postedBill(A);
    await expect(bills.recordSupplierPayment(A.ctx, { billId: bill.id, amount: 1000, method: "BANK_TRANSFER", date: today(), accountId: B.bank.id } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await setCompanyModule(A.company.id, "finance", false);
    const ctx = await ctxFor(A.owner.id, A.company.id);
    await payments.recordPayment(ctx, { invoiceId: inv.id, amount: 5000, method: "BANK_TRANSFER", date: today() } as never);
    expect((await tr.listTransactions(ctx, { skip: 0, take: 10 })).total).toBe(0);
  });
});

describe("dépenses", () => {
  it("brouillon → approuvée → payée : sortie de trésorerie, événement, numérotation DEP-année-00001", async () => {
    const s = await setup();
    await income(s, s.cash.id, 200000);
    const e = await expense(s, 50000);
    expect(e.number).toBe(`DEP-${new Date().getFullYear()}-00001`);
    await expect(ex.payExpense(s.ctx, { id: e.id, accountId: s.cash.id, date: today(), method: "CASH" } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" }); // pas encore approuvée
    expect(await ex.submitExpense(s.ctx, e.id)).toEqual({ needsApproval: false });
    await ex.payExpense(s.ctx, { id: e.id, accountId: s.cash.id, date: today(), method: "CASH", reference: "REC-77" } as never);
    expect(await s.balance(s.cash.id)).toBe(150000);
    const paid = await ex.getExpense(s.ctx, e.id);
    expect(paid).toMatchObject({ status: "PAID", accountId: s.cash.id, reference: "REC-77" });
    await expect(ex.payExpense(s.ctx, { id: e.id, accountId: s.cash.id, date: today(), method: "CASH" } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await ex.cancelExpense(s.ctx, e.id);
    expect(await s.balance(s.cash.id)).toBe(200000);
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("CANCELLED");
  });

  it("au-delà du seuil : validation par un tiers ; refus → correction et nouvelle soumission", async () => {
    const s = await setup();
    await savePolicy(s.ctx, { type: "expense", isEnabled: true, threshold: 100000 });
    const e = await ex.createExpense(s.requester, expenseSchema.parse({ date: today(), categoryId: s.expCat.id, description: "Groupe électrogène", amount: 450000, method: "BANK_TRANSFER" }));
    expect(await ex.submitExpense(s.requester, e.id)).toEqual({ needsApproval: true });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("PENDING_APPROVAL");
    const a = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 5 })).rows[0]!;
    await expect(decideApproval(s.requester, { id: a.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await decideApproval(s.ctx, { id: a.id, decision: "REJECTED", comment: "Demandez un second devis" });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("REJECTED");
    await ex.updateExpense(s.requester, { ...expenseSchema.parse({ date: today(), categoryId: s.expCat.id, description: "Groupe électrogène (devis 2)", amount: 380000, method: "BANK_TRANSFER" }), id: e.id });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("DRAFT");
    await ex.submitExpense(s.requester, e.id);
    const a2 = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 5 })).rows[0]!;
    await decideApproval(s.ctx, { id: a2.id, decision: "APPROVED" });
    expect((await ex.getExpense(s.ctx, e.id)).status).toBe("APPROVED");
    await ex.payExpense(s.ctx, { id: e.id, accountId: s.bank.id, date: today(), method: "BANK_TRANSFER" } as never);
    expect(await s.balance(s.bank.id)).toBe(-380000);
  });

  it("CONCURRENCE : 5 paiements simultanés de la même dépense → un seul décaissement", async () => {
    const s = await setup();
    await income(s, s.cash.id, 500000);
    const e = await expense(s, 100000);
    await ex.submitExpense(s.ctx, e.id);
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => ex.payExpense(s.ctx, { id: e.id, accountId: s.cash.id, date: today(), method: "CASH" } as never)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await s.balance(s.cash.id)).toBe(400000);
  });

  it("CONCURRENCE : sorties simultanées sur une caisse → jamais de solde négatif", async () => {
    const s = await setup();
    await income(s, s.cash.id, 100000);
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId: s.cash.id, type: "OUT", date: today(), amount: 30000, description: "Retrait" }))));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect(await s.balance(s.cash.id)).toBe(10000);
  });

  it("références validées : catégorie de dépense active, fournisseur et compte de l'entreprise ; suppression réservée au brouillon", async () => {
    const A = await setup();
    const B = await setup();
    const supB = await sup.createSupplier(B.ctx, supplierSchema.parse({ name: "Fournisseur B", paymentTermsDays: 0 }));
    await expect(expense(A, 1000, { categoryId: B.expCat.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(expense(A, 1000, { categoryId: A.incCat.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(expense(A, 1000, { supplierId: supB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(expense(A, 1000, { accountId: B.cash.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const e = await expense(A, 1000);
    await ex.submitExpense(A.ctx, e.id);
    await expect(ex.deleteExpense(A.ctx, e.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const e2 = await expense(A, 2000);
    await ex.deleteExpense(A.ctx, e2.id);
    // payer depuis le compte d'une autre entreprise
    await expect(ex.payExpense(A.ctx, { id: e.id, accountId: B.bank.id, date: today(), method: "CASH" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("budgets, flux et échéancier", () => {
  it("budget par catégorie/mois, réalisé issu des décaissements catégorisés, validation de la catégorie", async () => {
    const s = await setup();
    const year = new Date().getFullYear();
    await rp.saveBudget(s.ctx, budgetSchema.parse({ year, categoryId: s.expCat.id, months: Array(12).fill(100000) }));
    await income(s, s.bank.id, 1_000_000);
    await tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId: s.bank.id, type: "OUT", date: today(), amount: 40000, description: "Facture", categoryId: s.expCat.id }));
    const row = (await rp.budgetGrid(s.ctx, year)).find((r) => r.categoryId === s.expCat.id)!;
    const m = new Date().getUTCMonth();
    expect(row.budget[m]).toBe(100000);
    expect(row.actual[m]).toBe(40000);
    await rp.saveBudget(s.ctx, budgetSchema.parse({ year, categoryId: s.expCat.id, months: Array(12).fill(0) }));
    expect((await rp.budgetGrid(s.ctx, year)).find((r) => r.categoryId === s.expCat.id)!.budget.every((b) => b === 0)).toBe(true);
    await expect(rp.saveBudget(s.ctx, budgetSchema.parse({ year, categoryId: s.incCat.id, months: Array(12).fill(1) }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("flux mensuels (transferts exclus), échéancier créances/dettes et prévisionnel", async () => {
    const s = await setup();
    await income(s, s.bank.id, 500000);
    await tr.createTransfer(s.ctx, transferSchema.parse({ fromAccountId: s.bank.id, toAccountId: s.cash.id, amount: 100000, date: today() }));
    await tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId: s.cash.id, type: "OUT", date: today(), amount: 20000, description: "Frais" }));
    const flow = await rp.monthlyCashflow(s.ctx, 3);
    expect(flow).toHaveLength(3);
    expect(flow[2]).toMatchObject({ inflow: 500000, outflow: 20000 });

    await issuedInvoice(s, 10); // 118 000 à encaisser dans 30 jours
    await postedBill(s, 59000, { dueDate: daysAgo(5) }); // dette échue
    const due = await rp.dueSchedule(s.ctx);
    expect(due.receivables.reduce((a, b) => a + b.total, 0)).toBe(118000);
    expect(due.payables.find((b) => b.key === "overdue")!.total).toBe(59000);
    const fc = await rp.cashForecast(s.ctx);
    expect(fc.current).toBe(480000);
    expect(fc.points[0]).toMatchObject({ days: 30, in: 118000, out: 59000, balance: 480000 + 118000 - 59000 });
  });
});

describe("ISOLATION des finances", () => {
  it("aucun accès, modification ou lecture croisée entre entreprises", async () => {
    const A = await setup();
    const B = await setup();
    await income(B, B.cash.id, 70000);
    const tB = (await tr.listTransactions(B.ctx, { skip: 0, take: 5 })).rows[0]!;
    const eB = await expense(B, 1000);
    await expect(tr.getAccount(A.ctx, B.cash.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(tr.cancelTransaction(A.ctx, tB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(tr.setReconciled(A.ctx, tB.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ex.getExpense(A.ctx, eB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ex.submitExpense(A.ctx, eB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ex.cancelExpense(A.ctx, eB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(income(A, B.cash.id, 100)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(tr.createTransfer(A.ctx, transferSchema.parse({ fromAccountId: A.bank.id, toAccountId: B.bank.id, amount: 10, date: today() }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await tr.listTransactions(A.ctx, { skip: 0, take: 50 })).total).toBe(0);
    expect((await ex.listExpenses(A.ctx, { skip: 0, take: 50 })).total).toBe(0);
    expect((await tr.listAccounts(A.ctx)).map((a) => a.id).sort()).toEqual([A.cash.id, A.bank.id].sort());
    expect((await tr.treasuryTotal(A.ctx)).toNumber()).toBe(0);
    await expect(rp.saveBudget(A.ctx, budgetSchema.parse({ year: 2026, categoryId: B.expCat.id, months: Array(12).fill(10) }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

async function ctxPayment(s: S, id: string) {
  return s.ctx.db.payment.findFirstOrThrow({ where: { id } });
}
