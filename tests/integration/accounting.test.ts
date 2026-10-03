import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import * as ex from "@/modules/finance/expenses";
import { expenseSchema, manualTransactionSchema, transferSchema } from "@/modules/finance/schemas";
import * as tr from "@/modules/finance/treasury";
import * as inv from "@/modules/inventory/service";
import { productSchema } from "@/modules/inventory/schemas";
import { setCompanyModule } from "@/modules/platform/companies";
import * as bills from "@/modules/purchasing/bills";
import { supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import * as invoices from "@/modules/sales/invoices";
import * as payments from "@/modules/sales/payments";
import { invoiceSchema } from "@/modules/sales/schemas";
import * as acc from "@/modules/accounting/service";
import * as rep from "@/modules/accounting/reports";
import { ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);
const year = new Date().getUTCFullYear();

async function setup() {
  const co = await makeCompany("COMPTA", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const accounts = await tr.listAccounts(ctx);
  const cash = accounts.find((a) => a.type === "CASH")!;
  const bank = accounts.find((a) => a.type === "BANK")!;
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Client Compta", paymentTermsDays: 30 }));
  const goods = await inv.createProduct(ctx, productSchema.parse({ name: "Ciment", type: "GOODS", unit: "sac", salePrice: 6500, costPrice: 5000, trackStock: false, minStock: 0 }));
  const service = await inv.createProduct(ctx, productSchema.parse({ name: "Livraison", type: "SERVICE", unit: "forfait", salePrice: 20000, costPrice: 0, trackStock: false, minStock: 0 }));
  const fy = (await acc.listFiscalYears(ctx)).find((f) => f.name === String(year))!;
  return { ...co, ctx, tax, cash, bank, customer, goods, service, fy };
}
type S = Awaited<ReturnType<typeof setup>>;

const entryOf = async (s: S, sourceType: string, sourceId: string) => s.ctx.db.journalEntry.findFirst({ where: { sourceType, sourceId }, include: { journal: true, lines: { include: { ledgerAccount: true }, orderBy: { position: "asc" } } } });
const shape = (e: NonNullable<Awaited<ReturnType<typeof entryOf>>>) => e.lines.map((l) => `${l.ledgerAccount.code}:${Number(l.debit) ? `D${Number(l.debit)}` : `C${Number(l.credit)}`}`);
const balanceOf = async (s: S, code: string, fiscalYearId = s.fy.id) => (await rep.trialBalance(s.ctx, { fiscalYearId })).rows.find((r) => r.code === code)?.balance.toNumber() ?? 0;

async function issued(s: S, opts: { qty?: number; date?: string; service?: boolean } = {}) {
  const lines = [{ productId: s.goods.id, description: "Ciment", unit: "sac", quantity: opts.qty ?? 10, unitPrice: 10000, discountPct: 0, taxId: s.tax.id }];
  if (opts.service) lines.push({ productId: s.service.id, description: "Livraison", unit: "forfait", quantity: 1, unitPrice: 20000, discountPct: 0, taxId: s.tax.id });
  const draft = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: s.customer.id, issueDate: opts.date ?? today(), lines }));
  return invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
}

async function postedBill(s: S, net = 100000, over: { productId?: string } = {}) {
  const supplier = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: `Fournisseur ${Math.random().toString(36).slice(2, 7)}`, paymentTermsDays: 30 }));
  const draft = await bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId: supplier.id, supplierRef: `F-${Math.random().toString(36).slice(2, 7)}`, billDate: today(), lines: [{ productId: over.productId ?? "", description: "Achat", quantity: 1, unitPrice: net, taxId: s.tax.id }] }));
  return bills.postBill(s.ctx, draft.id);
}

describe("initialisation", () => {
  it("plan comptable, journaux, correspondances et exercice en cours créés par défaut", async () => {
    const s = await setup();
    const chart = await acc.listLedgerAccounts(s.ctx);
    expect(chart.find((a) => a.code === "411")).toMatchObject({ name: "Clients", class: 4 });
    expect((await acc.listJournals(s.ctx)).map((j) => j.code).sort()).toEqual(["ACH", "AN", "BQ", "CAI", "OD", "VTE"]);
    const maps = await acc.listMappings(s.ctx);
    expect(maps.every((m) => m.account)).toBe(true);
    expect(maps.find((m) => m.key === "vat_collected")!.account!.code).toBe("4431");
    expect(s.fy.periods).toHaveLength(12);
    expect(s.fy.status).toBe("OPEN");
    expect((await s.ctx.db.financeCategory.findFirst({ where: { name: "Loyer et charges locatives" } }))!.ledgerCode).toBe("622");
  });
});

describe("écritures automatiques — ventes", () => {
  it("facture émise : Dr clients / Cr ventes + TVA, équilibrée, numérotée ; services sur 706", async () => {
    const s = await setup();
    const i = await issued(s, { qty: 10, service: true }); // 100 000 marchandises + 20 000 services, TVA 18 % = 21 600 ; TTC 141 600
    const e = (await entryOf(s, "invoice", i.id))!;
    expect(e).toMatchObject({ status: "POSTED", reference: i.number });
    expect(e.journal.code).toBe("VTE");
    expect(e.number).toBe(`ECR-${year}-000001`);
    expect(shape(e)).toEqual(["411:D141600", "701:C100000", "706:C20000", "4431:C21600"]);
    expect(e.lines[0]).toMatchObject({ partyType: "customer", partyId: s.customer.id });
    expect(await balanceOf(s, "411")).toBe(141600);
  });

  it("encaissement : banque / caisse selon le compte ; annulation → contre-passation", async () => {
    const s = await setup();
    const i = await issued(s, { qty: 10 }); // 118 000
    const p1 = await payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 70000, method: "BANK_TRANSFER", date: today() } as never);
    const p2 = await payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 18000, method: "CASH", date: today() } as never);
    const e1 = (await entryOf(s, "payment", p1.id))!;
    const e2 = (await entryOf(s, "payment", p2.id))!;
    expect(e1.journal.code).toBe("BQ");
    expect(shape(e1)).toEqual(["521:D70000", "411:C70000"]);
    expect(e2.journal.code).toBe("CAI");
    expect(shape(e2)).toEqual(["571:D18000", "411:C18000"]);
    expect(await balanceOf(s, "411")).toBe(30000);
    await payments.cancelPayment(s.ctx, p2.id);
    const rev = (await entryOf(s, "payment:reversal", p2.id))!;
    expect(rev.reversalOfId).toBe(e2.id);
    expect(shape(rev)).toEqual(["571:C18000", "411:D18000"]);
    expect(await balanceOf(s, "411")).toBe(48000);
    expect(await balanceOf(s, "571")).toBe(0);
  });

  it("annulation de facture et avoir : écritures inverses", async () => {
    const s = await setup();
    const a = await issued(s, { qty: 5 }); // 59 000
    await invoices.cancelInvoice(s.ctx, a.id);
    expect(shape((await entryOf(s, "invoice:reversal", a.id))!)).toEqual(["411:C59000", "701:D50000", "4431:D9000"]);
    expect(await balanceOf(s, "411")).toBe(0);
    const b = await issued(s, { qty: 10 });
    const full = await invoices.getInvoice(s.ctx, b.id);
    const cn = await invoices.createCreditNote(s.ctx, { invoiceId: b.id, reason: "Retour", restock: false, lines: [{ invoiceLineId: full.lines[0]!.id, quantity: 2 }] });
    await invoices.issueCreditNote(s.ctx, cn.id);
    expect(shape((await entryOf(s, "credit_note", cn.id))!)).toEqual(["411:C23600", "701:D20000", "4431:D3600"]);
    expect(await balanceOf(s, "411")).toBe(94400);
  });
});

describe("écritures automatiques — achats et finance", () => {
  it("facture fournisseur : achats (marchandises/autres) + TVA récupérable / fournisseurs ; règlement ; annulation", async () => {
    const s = await setup();
    const b = await postedBill(s, 100000, { productId: s.goods.id });
    expect(shape((await entryOf(s, "supplier_bill", b.id))!)).toEqual(["601:D100000", "4452:D18000", "401:C118000"]);
    const b2 = await postedBill(s, 50000);
    expect(shape((await entryOf(s, "supplier_bill", b2.id))!)).toEqual(["605:D50000", "4452:D9000", "401:C59000"]);
    const p = await bills.recordSupplierPayment(s.ctx, { billId: b.id, amount: 118000, method: "BANK_TRANSFER", date: today() } as never);
    expect(shape((await entryOf(s, "supplier_payment", p.id))!)).toEqual(["401:D118000", "521:C118000"]);
    expect(await balanceOf(s, "401")).toBe(-59000);
    await bills.cancelSupplierPayment(s.ctx, p.id);
    expect(await balanceOf(s, "401")).toBe(-177000);
    await bills.cancelBill(s.ctx, b2.id);
    expect(await balanceOf(s, "401")).toBe(-118000);
  });

  it("dépense payée, saisie manuelle et transfert → écritures ; annulations → contre-passations", async () => {
    const s = await setup();
    await tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId: s.cash.id, type: "IN", date: today(), amount: 300000, description: "Apport", categoryId: (await tr.listCategories(s.ctx, { kind: "INCOME" })).find((c) => c.name === "Apport en capital")!.id }));
    const mt = (await s.ctx.db.financialTransaction.findFirstOrThrow({ where: { sourceType: "manual" } }));
    expect(shape((await entryOf(s, "manual_transaction", mt.id))!)).toEqual(["571:D300000", "101:C300000"]);

    const loyer = (await tr.listCategories(s.ctx, { kind: "EXPENSE" })).find((c) => c.name === "Loyer et charges locatives")!;
    const e = await ex.createExpense(s.ctx, expenseSchema.parse({ date: today(), categoryId: loyer.id, description: "Loyer", amount: 120000, method: "CASH" }));
    await ex.submitExpense(s.ctx, e.id);
    await ex.payExpense(s.ctx, { id: e.id, accountId: s.cash.id, date: today(), method: "CASH" } as never);
    expect(shape((await entryOf(s, "expense", e.id))!)).toEqual(["622:D120000", "571:C120000"]);
    await ex.cancelExpense(s.ctx, e.id);
    expect(shape((await entryOf(s, "expense:reversal", e.id))!)).toEqual(["622:C120000", "571:D120000"]);

    await tr.createTransfer(s.ctx, transferSchema.parse({ fromAccountId: s.cash.id, toAccountId: s.bank.id, amount: 100000, date: today() }));
    const group = (await s.ctx.db.financialTransaction.findFirstOrThrow({ where: { type: "TRANSFER_OUT" } })).transferGroupId!;
    expect(shape((await entryOf(s, "transfer", group))!)).toEqual(["521:D100000", "571:C100000"]);
    await tr.cancelTransaction(s.ctx, (await s.ctx.db.financialTransaction.findFirstOrThrow({ where: { type: "TRANSFER_OUT" } })).id);
    expect(await entryOf(s, "transfer:reversal", group)).not.toBeNull();
    // la trésorerie comptable correspond à la trésorerie réelle
    expect(await balanceOf(s, "571")).toBe((await tr.getAccount(s.ctx, s.cash.id)).balance.toNumber());
    expect(await balanceOf(s, "521")).toBe((await tr.getAccount(s.ctx, s.bank.id)).balance.toNumber());
  });
});

describe("soldes d'ouverture de trésorerie", () => {
  it("un compte créé avec un solde est comptabilisé (471) ; le solde comptable égale le solde réel ; plus modifiable ensuite", async () => {
    const s = await setup();
    const acct = await tr.createAccount(s.ctx, { name: "Ecobank", type: "BANK", openingBalance: 2_500_000, isDefault: false } as never);
    const e = (await entryOf(s, "opening_balance", acct.id))!;
    expect(e.journal.code).toBe("AN");
    expect(shape(e)).toEqual(["521:D2500000", "471:C2500000"]);
    const overdraft = await tr.createAccount(s.ctx, { name: "Caisse spéciale", type: "CASH", openingBalance: -1000, isDefault: false } as never);
    expect(shape((await entryOf(s, "opening_balance", overdraft.id))!)).toEqual(["471:D1000", "571:C1000"]);
    expect(await balanceOf(s, "521")).toBe(2_500_000);
    await expect(tr.updateAccount(s.ctx, { id: acct.id, name: "Ecobank", type: "BANK", openingBalance: 1, isDefault: false, isActive: true } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // solde nul : aucune écriture
    const zero = await tr.createAccount(s.ctx, { name: "Wave", type: "MOBILE_MONEY", openingBalance: 0, isDefault: false } as never);
    expect(await entryOf(s, "opening_balance", zero.id)).toBeNull();
  });
});

describe("états comptables", () => {
  it("balance équilibrée, compte de résultat, bilan actif = passif, grand livre avec solde progressif", async () => {
    const s = await setup();
    await issued(s, { qty: 10 }); // CA 100 000, TVA 18 000
    const i2 = await issued(s, { qty: 20 }); // CA 200 000
    await payments.recordPayment(s.ctx, { invoiceId: i2.id, amount: 100000, method: "BANK_TRANSFER", date: today() } as never);
    await postedBill(s, 40000); // achat 40 000
    const loyer = (await tr.listCategories(s.ctx, { kind: "EXPENSE" })).find((c) => c.name === "Loyer et charges locatives")!;
    const e = await ex.createExpense(s.ctx, expenseSchema.parse({ date: today(), categoryId: loyer.id, description: "Loyer", amount: 60000, method: "BANK_TRANSFER" }));
    await ex.submitExpense(s.ctx, e.id);
    await ex.payExpense(s.ctx, { id: e.id, accountId: s.bank.id, date: today(), method: "BANK_TRANSFER" } as never);

    const tb = await rep.trialBalance(s.ctx, { fiscalYearId: s.fy.id });
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit.toNumber()).toBeGreaterThan(0);
    const is = await rep.incomeStatement(s.ctx, { fiscalYearId: s.fy.id });
    expect(is.totalProducts.toNumber()).toBe(300000);
    expect(is.totalCharges.toNumber()).toBe(100000); // 40 000 achats + 60 000 loyer
    expect(is.result.toNumber()).toBe(200000);
    const bs = await rep.balanceSheet(s.ctx, { fiscalYearId: s.fy.id });
    expect(bs.totalAssets.toNumber()).toBe(bs.totalLiabilities.toNumber());
    expect(bs.liabilities.some((l) => l.name.includes("Résultat"))).toBe(true);

    const clients = (await acc.listLedgerAccounts(s.ctx, { q: "411" }))[0]!;
    const gl = await rep.generalLedger(s.ctx, { accountId: clients.id, fiscalYearId: s.fy.id });
    expect(gl.rows).toHaveLength(3);
    expect(gl.closingBalance.toNumber()).toBe(118000 + 236000 - 100000);
    expect(gl.rows.at(-1)!.running.toNumber()).toBe(gl.closingBalance.toNumber());
  });
});

describe("immutabilité et contrôles", () => {
  it("une écriture validée ne peut être ni modifiée ni supprimée, même par une requête directe", async () => {
    const s = await setup();
    const i = await issued(s);
    const e = (await entryOf(s, "invoice", i.id))!;
    await expect(s.ctx.db.journalEntry.update({ where: { id: e.id }, data: { description: "Falsifiée" } })).rejects.toThrow();
    await expect(s.ctx.db.journalEntry.delete({ where: { id: e.id } })).rejects.toThrow();
    await expect(s.ctx.db.journalLine.update({ where: { id: e.lines[0]!.id }, data: { debit: 1 } })).rejects.toThrow();
    await expect(s.ctx.db.journalLine.delete({ where: { id: e.lines[0]!.id } })).rejects.toThrow();
    await expect(s.ctx.tx((tx) => tx.$executeRaw`UPDATE "JournalLine" SET "debit" = 1 WHERE "entryId" = ${e.id}::uuid`)).rejects.toThrow();
    await expect(s.ctx.tx((tx) => tx.journalLine.create({ data: { companyId: s.company.id, entryId: e.id, position: 9, ledgerAccountId: e.lines[0]!.ledgerAccountId, label: "Ajout", debit: 5 } }))).rejects.toThrow();
    // les montants négatifs ou débit+crédit simultanés sont refusés par la base
    const draft = await acc.createManualEntry(s.ctx, { journalId: (await acc.listJournals(s.ctx)).find((j) => j.code === "OD")!.id, date: today(), description: "Test", lines: [{ ledgerAccountId: e.lines[0]!.ledgerAccountId, label: "a", debit: 10, credit: 0 }, { ledgerAccountId: e.lines[1]!.ledgerAccountId, label: "b", debit: 0, credit: 10 }] } as never);
    await expect(s.ctx.tx((tx) => tx.$executeRaw`UPDATE "JournalLine" SET "debit" = 5, "credit" = 5 WHERE "entryId" = ${draft.id}::uuid`)).rejects.toThrow();
  });

  it("écritures manuelles : brouillon → validation (numéro séquentiel attribué à la validation), déséquilibre refusé, contre-passation", async () => {
    const s = await setup();
    const od = (await acc.listJournals(s.ctx)).find((j) => j.code === "OD")!;
    const a = (code: string) => acc.listLedgerAccounts(s.ctx, { q: code }).then((r) => r.find((x) => x.code === code)!.id);
    const lines = async (amount: number) => [{ ledgerAccountId: await a("658"), label: "Charge", debit: amount, credit: 0 }, { ledgerAccountId: await a("471"), label: "Attente", debit: 0, credit: amount }];
    const d1 = await acc.createManualEntry(s.ctx, { journalId: od.id, date: today(), description: "Régularisation 1", lines: await lines(5000) } as never);
    const d2 = await acc.createManualEntry(s.ctx, { journalId: od.id, date: today(), description: "Brouillon à supprimer", lines: await lines(1) } as never);
    const bad = await acc.createManualEntry(s.ctx, { journalId: od.id, date: today(), description: "Déséquilibrée", lines: [{ ledgerAccountId: await a("658"), label: "x", debit: 100, credit: 0 }, { ledgerAccountId: await a("471"), label: "y", debit: 0, credit: 90 }] } as never);
    await expect(acc.validateManualEntry(s.ctx, bad.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("déséquilibrée") });
    await acc.deleteManualEntry(s.ctx, d2.id);
    const v = await acc.validateManualEntry(s.ctx, d1.id);
    expect(v.number).toBe(`ECR-${year}-000001`); // pas de trou : les brouillons ne consomment pas de numéro
    await expect(acc.updateManualEntry(s.ctx, { id: d1.id, journalId: od.id, date: today(), description: "x", lines: await lines(9) } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(acc.deleteManualEntry(s.ctx, d1.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(await balanceOf(s, "658")).toBe(5000);
    const rev = await acc.reverseManualEntry(s.ctx, d1.id);
    expect(rev.number).toBe(`ECR-${year}-000002`);
    expect(await balanceOf(s, "658")).toBe(0);
    await expect(acc.reverseManualEntry(s.ctx, d1.id)).resolves.toMatchObject({ id: rev.id }); // idempotent
    await expect(acc.reverseManualEntry(s.ctx, rev.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // une écriture de document ne se contre-passe pas à la main
    const i = await issued(s);
    await expect(acc.reverseManualEntry(s.ctx, (await entryOf(s, "invoice", i.id))!.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("plan comptable : code valide et unique, correspondances de même classe, compte utilisé non désactivable", async () => {
    const s = await setup();
    await expect(acc.createLedgerAccount(s.ctx, { code: "411", name: "Doublon" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const created = await acc.createLedgerAccount(s.ctx, { code: "4111", name: "Clients — Abidjan" });
    expect(created.class).toBe(4);
    const customersMap = (await acc.listMappings(s.ctx)).find((m) => m.key === "customers")!;
    await expect(acc.updateLedgerAccount(s.ctx, { id: customersMap.account!.id, name: "Clients", isActive: false })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await acc.setMapping(s.ctx, { key: "customers", ledgerAccountId: created.id });
    const i = await issued(s);
    expect((await entryOf(s, "invoice", i.id))!.lines[0]!.ledgerAccount.code).toBe("4111");
    const sales = (await acc.listLedgerAccounts(s.ctx, { q: "701" }))[0]!;
    await expect(acc.setMapping(s.ctx, { key: "customers", ledgerAccountId: sales.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("périodes et exercices", () => {
  it("période verrouillée : l'émission est refusée (rien n'est modifié) puis acceptée après réouverture", async () => {
    const s = await setup();
    const month = s.fy.periods.find((p) => p.startDate <= new Date() && p.endDate >= new Date())!;
    await acc.setPeriodLocked(s.ctx, month.id, true);
    const draft = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: s.customer.id, issueDate: today(), lines: [{ description: "X", unit: "u", quantity: 1, unitPrice: 1000, discountPct: 0, taxId: s.tax.id }] }));
    await expect(invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("verrouillée") });
    expect((await invoices.getInvoice(s.ctx, draft.id)).status).toBe("DRAFT");
    await acc.setPeriodLocked(s.ctx, month.id, false);
    await expect(invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false })).resolves.toMatchObject({ status: "ISSUED" });
  });

  it("exercice : chevauchement refusé ; clôture → résultat 131, à-nouveaux dans l'exercice suivant, exercice verrouillé", async () => {
    const s = await setup();
    const prev = year - 1;
    const i = await issued(s, { qty: 10, date: `${prev}-06-15` }); // auto-création de l'exercice précédent
    await payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 118000, method: "BANK_TRANSFER", date: `${prev}-07-01` } as never);
    const years = await acc.listFiscalYears(s.ctx);
    const py = years.find((y) => y.name === String(prev))!;
    await expect(acc.createFiscalYear(s.ctx, { name: "Chevauche", startDate: `${prev}-03-01`, endDate: `${prev + 1}-02-28` })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(acc.closeFiscalYear(s.ctx, s.fy.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("d'abord") });

    const res = await acc.closeFiscalYear(s.ctx, py.id);
    expect(res).toMatchObject({ profit: 100000, nextYear: String(year) });
    expect(await balanceOf(s, "701", py.id)).toBe(0);
    expect(await balanceOf(s, "131", py.id)).toBe(-100000);
    // à-nouveaux : banque 118 000 débiteur, TVA 18 000 créditeur, résultat 100 000 créditeur dans l'exercice courant
    const an = await s.ctx.db.journalEntry.findFirstOrThrow({ where: { fiscalYearId: s.fy.id, sourceType: "year_open" }, include: { journal: true } });
    expect(an.journal.code).toBe("AN");
    expect(await balanceOf(s, "521")).toBe(118000);
    expect(await balanceOf(s, "131")).toBe(-100000);
    expect(await balanceOf(s, "4431")).toBe(-18000);
    const bs = await rep.balanceSheet(s.ctx, { fiscalYearId: s.fy.id });
    expect(bs.totalAssets.toNumber()).toBe(bs.totalLiabilities.toNumber());
    // exercice clos : aucune écriture ni modification de période
    const closed = (await acc.listFiscalYears(s.ctx)).find((y) => y.id === py.id)!;
    expect(closed.status).toBe("CLOSED");
    await expect(acc.setPeriodLocked(s.ctx, closed.periods[0]!.id, false)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const late = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: s.customer.id, issueDate: `${prev}-12-20`, lines: [{ description: "X", unit: "u", quantity: 1, unitPrice: 1000, discountPct: 0, taxId: s.tax.id }] }));
    await expect(invoices.issueInvoice(s.ctx, { id: late.id, installments: 1, allowOverLimit: false })).rejects.toMatchObject({ message: expect.stringContaining("clôturé") });
    await expect(acc.closeFiscalYear(s.ctx, py.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("module inactif, rattrapage, concurrence", () => {
  it("sans module Comptabilité : aucune écriture ; à l'activation, le rattrapage comptabilise l'existant (idempotent)", async () => {
    const s = await setup();
    await setCompanyModule(s.company.id, "accounting", false);
    const ctx = await ctxFor(s.owner.id, s.company.id);
    const draft = await invoices.createInvoice(ctx, invoiceSchema.parse({ customerId: s.customer.id, issueDate: today(), lines: [{ description: "X", unit: "u", quantity: 1, unitPrice: 50000, discountPct: 0, taxId: s.tax.id }] }));
    const i = await invoices.issueInvoice(ctx, { id: draft.id, installments: 1, allowOverLimit: false });
    const p = await payments.recordPayment(ctx, { invoiceId: i.id, amount: 20000, method: "CASH", date: today() } as never);
    expect(await ctx.db.journalEntry.count()).toBe(0);
    await setCompanyModule(s.company.id, "accounting", true);
    const ctx2 = await ctxFor(s.owner.id, s.company.id);
    const r = await acc.generateMissingEntries(ctx2);
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(2);
    expect(await ctx2.db.journalEntry.count()).toBe(2);
    expect((await ctx2.db.journalEntry.findFirst({ where: { sourceType: "payment", sourceId: p.id } }))).not.toBeNull();
    expect((await acc.generateMissingEntries(ctx2)).created).toBe(0);
  });

  it("CONCURRENCE : 6 factures émises simultanément → numéros d'écritures uniques et consécutifs, balance équilibrée", async () => {
    const s = await setup();
    const drafts = await Promise.all(Array.from({ length: 6 }, (_, k) => invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: s.customer.id, issueDate: today(), lines: [{ description: "X", unit: "u", quantity: 1, unitPrice: 1000 * (k + 1), discountPct: 0, taxId: s.tax.id }] }))));
    const r = await Promise.allSettled(drafts.map((dr) => invoices.issueInvoice(s.ctx, { id: dr.id, installments: 1, allowOverLimit: false })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(6);
    const numbers = (await s.ctx.db.journalEntry.findMany({ select: { number: true } })).map((e) => e.number).sort();
    expect(numbers).toEqual(Array.from({ length: 6 }, (_, k) => `ECR-${year}-${String(k + 1).padStart(6, "0")}`));
    expect((await rep.trialBalance(s.ctx, { fiscalYearId: s.fy.id })).balanced).toBe(true);
  });
});

describe("ISOLATION de la comptabilité", () => {
  it("aucun accès aux comptes, écritures, exercices ou correspondances d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const iB = await issued(B);
    const eB = (await entryOf(B, "invoice", iB.id))!;
    expect(await A.ctx.db.journalEntry.count()).toBe(0);
    expect((await rep.trialBalance(A.ctx, { fiscalYearId: A.fy.id })).rows).toHaveLength(0);
    await expect(rep.trialBalance(A.ctx, { fiscalYearId: B.fy.id }).then((r) => r.rows)).resolves.toHaveLength(0);
    await expect(rep.defaultFiscalYear(A.ctx, B.fy.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(rep.generalLedger(A.ctx, { accountId: eB.lines[0]!.ledgerAccountId, fiscalYearId: A.fy.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(acc.setMapping(A.ctx, { key: "customers", ledgerAccountId: eB.lines[0]!.ledgerAccountId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(acc.reverseManualEntry(A.ctx, eB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(acc.setPeriodLocked(A.ctx, B.fy.periods[0]!.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(acc.closeFiscalYear(A.ctx, B.fy.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const od = (await acc.listJournals(A.ctx)).find((j) => j.code === "OD")!;
    await expect(acc.createManualEntry(A.ctx, { journalId: od.id, date: today(), description: "Croisée", lines: [{ ledgerAccountId: eB.lines[0]!.ledgerAccountId, label: "x", debit: 5, credit: 0 }, { ledgerAccountId: eB.lines[1]!.ledgerAccountId, label: "y", debit: 0, credit: 5 }] } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // la comptabilité d'A reste intacte et cloisonnée
    expect(await balanceOf(B, "411")).toBe(118000);
    expect(await balanceOf(A, "411")).toBe(0);
  });
});
