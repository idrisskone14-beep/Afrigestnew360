import "server-only";
import type { Db } from "@/core/db/client";
import { d } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { type MappingKey } from "./chart";
import { postEntry, reverseSource, toDay, type EntryLineInput } from "./engine";

type Ctx = TenantContext;
type AccountType = "BANK" | "CASH" | "MOBILE_MONEY";

const TREASURY_MAPPING: Record<AccountType, MappingKey> = { BANK: "treasury_bank", CASH: "treasury_cash", MOBILE_MONEY: "treasury_mobile" };
const TREASURY_JOURNAL: Record<AccountType, string> = { BANK: "BQ", MOBILE_MONEY: "BQ", CASH: "CAI" };
const methodType = (method: string | null | undefined): AccountType => (method === "CASH" ? "CASH" : method === "MOBILE_MONEY" ? "MOBILE_MONEY" : "BANK");

async function accountType(tx: Db, accountId: string | null | undefined, method?: string | null): Promise<AccountType> {
  if (accountId) {
    const a = await tx.financeAccount.findFirst({ where: { id: accountId }, select: { type: true } });
    if (a) return a.type;
  }
  return methodType(method);
}

async function productKinds(tx: Db, ids: (string | null)[]) {
  const productIds = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const products = productIds.length ? await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, type: true } }) : [];
  return new Map(products.map((p) => [p.id, p.type]));
}

/** Ventilation par compte d'un document à lignes : somme des montants nets par compte de produit/charge, TVA à part. */
function groupNet<L extends { productId: string | null; netAmount: unknown }>(lines: L[], kinds: Map<string, string>, pick: (kind: string | undefined) => MappingKey) {
  const out = new Map<MappingKey, ReturnType<typeof d>>();
  for (const l of lines) {
    const key = pick(l.productId ? kinds.get(l.productId) : undefined);
    out.set(key, (out.get(key) ?? d(0)).plus(d(l.netAmount as number)));
  }
  return out;
}
const salesKey = (kind: string | undefined): MappingKey => (kind === "SERVICE" ? "sales_services" : "sales_goods");
const purchaseKey = (kind: string | undefined): MappingKey => (kind === "GOODS" ? "purchases_goods" : "purchases_other");

// ═══ Ventes ═══════════════════════════════════════════════════

export async function postInvoice(tx: Db, ctx: Ctx, invoiceId: string) {
  const inv = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId }, include: { lines: true, customer: { select: { name: true } } } });
  const kinds = await productKinds(tx, inv.lines.map((l) => l.productId));
  const label = `Facture ${inv.number} — ${inv.customer.name}`;
  const lines: EntryLineInput[] = [{ mapping: "customers", label, debit: inv.total, partyType: "customer", partyId: inv.customerId }];
  for (const [key, amount] of groupNet(inv.lines, kinds, salesKey)) lines.push({ mapping: key, label, credit: amount });
  const tax = inv.lines.reduce((a, l) => a.plus(l.taxAmount), d(0));
  if (tax.gt(0)) lines.push({ mapping: "vat_collected", label: `TVA — ${label}`, credit: tax });
  return postEntry(tx, ctx, { journal: "VTE", date: inv.issueDate, description: label, reference: inv.number, lines, sourceType: "invoice", sourceId: inv.id });
}

export const reverseInvoice = (tx: Db, ctx: Ctx, invoiceId: string) => reverseSource(tx, ctx, "invoice", invoiceId, toDay(new Date()), "Annulation de facture");

export async function postCreditNote(tx: Db, ctx: Ctx, creditNoteId: string) {
  const cn = await tx.creditNote.findFirstOrThrow({ where: { id: creditNoteId }, include: { lines: true, invoice: { select: { number: true, customerId: true, customer: { select: { name: true } } } } } });
  const kinds = await productKinds(tx, cn.lines.map((l) => l.productId));
  const label = `Avoir ${cn.number} — ${cn.invoice.customer.name}`;
  const lines: EntryLineInput[] = [{ mapping: "customers", label, credit: cn.total, partyType: "customer", partyId: cn.invoice.customerId }];
  for (const [key, amount] of groupNet(cn.lines, kinds, salesKey)) lines.push({ mapping: key, label, debit: amount });
  const tax = cn.lines.reduce((a, l) => a.plus(l.taxAmount), d(0));
  if (tax.gt(0)) lines.push({ mapping: "vat_collected", label: `TVA — ${label}`, debit: tax });
  return postEntry(tx, ctx, { journal: "VTE", date: cn.issueDate ?? new Date(), description: label, reference: cn.number, lines, sourceType: "credit_note", sourceId: cn.id });
}

export async function postCustomerPayment(tx: Db, ctx: Ctx, paymentId: string) {
  const p = await tx.payment.findFirstOrThrow({ where: { id: paymentId }, include: { customer: { select: { name: true } }, invoice: { select: { number: true } } } });
  const type = await accountType(tx, p.accountId, p.method);
  const label = `Encaissement ${p.number} — ${p.customer?.name ?? ""}${p.invoice?.number ? ` (${p.invoice.number})` : ""}`;
  return postEntry(tx, ctx, {
    journal: TREASURY_JOURNAL[type], date: p.date, description: label, reference: p.number, sourceType: "payment", sourceId: p.id,
    lines: [{ mapping: TREASURY_MAPPING[type], label, debit: p.amount }, { mapping: "customers", label, credit: p.amount, partyType: "customer", partyId: p.customerId }],
  });
}
export const reverseCustomerPayment = (tx: Db, ctx: Ctx, paymentId: string) => reverseSource(tx, ctx, "payment", paymentId, toDay(new Date()), "Annulation d'encaissement");

// ═══ Achats ═══════════════════════════════════════════════════

export async function postSupplierBill(tx: Db, ctx: Ctx, billId: string) {
  const b = await tx.supplierBill.findFirstOrThrow({ where: { id: billId }, include: { lines: true, supplier: { select: { name: true } } } });
  const kinds = await productKinds(tx, b.lines.map((l) => l.productId));
  const label = `Facture fournisseur ${b.number}${b.supplierRef ? ` (${b.supplierRef})` : ""} — ${b.supplier.name}`;
  const lines: EntryLineInput[] = [];
  for (const [key, amount] of groupNet(b.lines, kinds, purchaseKey)) lines.push({ mapping: key, label, debit: amount });
  const tax = b.lines.reduce((a, l) => a.plus(l.taxAmount), d(0));
  if (tax.gt(0)) lines.push({ mapping: "vat_deductible", label: `TVA — ${label}`, debit: tax });
  lines.push({ mapping: "suppliers", label, credit: b.total, partyType: "supplier", partyId: b.supplierId });
  return postEntry(tx, ctx, { journal: "ACH", date: b.billDate, description: label, reference: b.number, lines, sourceType: "supplier_bill", sourceId: b.id });
}
export const reverseSupplierBill = (tx: Db, ctx: Ctx, billId: string) => reverseSource(tx, ctx, "supplier_bill", billId, toDay(new Date()), "Annulation de facture fournisseur");

export async function postSupplierPayment(tx: Db, ctx: Ctx, paymentId: string) {
  const p = await tx.payment.findFirstOrThrow({ where: { id: paymentId }, include: { supplier: { select: { name: true } }, bill: { select: { number: true } } } });
  const type = await accountType(tx, p.accountId, p.method);
  const label = `Règlement ${p.number} — ${p.supplier?.name ?? ""}${p.bill?.number ? ` (${p.bill.number})` : ""}`;
  return postEntry(tx, ctx, {
    journal: TREASURY_JOURNAL[type], date: p.date, description: label, reference: p.number, sourceType: "supplier_payment", sourceId: p.id,
    lines: [{ mapping: "suppliers", label, debit: p.amount, partyType: "supplier", partyId: p.supplierId }, { mapping: TREASURY_MAPPING[type], label, credit: p.amount }],
  });
}
export const reverseSupplierPayment = (tx: Db, ctx: Ctx, paymentId: string) => reverseSource(tx, ctx, "supplier_payment", paymentId, toDay(new Date()), "Annulation de règlement fournisseur");

// ═══ Finance ══════════════════════════════════════════════════

/** Compte de charge/produit d'une catégorie financière ; à défaut, 658 (charges diverses) / 758 (produits divers). */
async function categoryAccount(tx: Db, categoryId: string | null, kind: "INCOME" | "EXPENSE") {
  const fallback = kind === "EXPENSE" ? "658" : "758";
  if (!categoryId) return "471"; // sans catégorie : compte d'attente, à ventiler
  const cat = await tx.financeCategory.findFirst({ where: { id: categoryId }, select: { ledgerCode: true } });
  if (cat?.ledgerCode && (await tx.ledgerAccount.findFirst({ where: { code: cat.ledgerCode, isActive: true }, select: { id: true } }))) return cat.ledgerCode;
  return fallback;
}

export async function postExpense(tx: Db, ctx: Ctx, expenseId: string) {
  const e = await tx.expense.findFirstOrThrow({ where: { id: expenseId }, include: { category: { select: { name: true } } } });
  const type = await accountType(tx, e.accountId, e.method);
  const label = `Dépense ${e.number} — ${e.description}`;
  const account = await categoryAccount(tx, e.categoryId, "EXPENSE");
  return postEntry(tx, ctx, {
    journal: TREASURY_JOURNAL[type], date: e.paidAt ?? e.date, description: label, reference: e.number, sourceType: "expense", sourceId: e.id,
    lines: [{ account, label, debit: e.amount }, { mapping: TREASURY_MAPPING[type], label, credit: e.amount }],
  });
}
export const reverseExpense = (tx: Db, ctx: Ctx, expenseId: string) => reverseSource(tx, ctx, "expense", expenseId, toDay(new Date()), "Annulation de dépense");

export async function postManualTransaction(tx: Db, ctx: Ctx, transactionId: string) {
  const t = await tx.financialTransaction.findFirstOrThrow({ where: { id: transactionId }, include: { account: { select: { type: true } } } });
  const inflow = t.type === "IN";
  const type = t.account.type;
  const other = await categoryAccount(tx, t.categoryId, inflow ? "INCOME" : "EXPENSE");
  const label = t.description;
  return postEntry(tx, ctx, {
    journal: TREASURY_JOURNAL[type], date: t.date, description: label, reference: t.reference, sourceType: "manual_transaction", sourceId: t.id,
    lines: inflow
      ? [{ mapping: TREASURY_MAPPING[type], label, debit: t.amount }, { account: other, label, credit: t.amount }]
      : [{ account: other, label, debit: t.amount }, { mapping: TREASURY_MAPPING[type], label, credit: t.amount }],
  });
}
export const reverseManualTransaction = (tx: Db, ctx: Ctx, transactionId: string) => reverseSource(tx, ctx, "manual_transaction", transactionId, toDay(new Date()), "Annulation de mouvement");

// ═══ Paie ═════════════════════════════════════════════════════

/**
 * Écriture de paie à la validation de la campagne (fin du mois) :
 *  Dr rémunérations brutes + charges patronales / Cr salaires nets dus + organismes sociaux + impôt retenu + autres retenues.
 */
export async function postPayrollValidated(tx: Db, ctx: Ctx, runId: string) {
  const run = await tx.payrollRun.findFirstOrThrow({ where: { id: runId } });
  const lines = await tx.payslipLine.findMany({ where: { payslip: { runId } }, select: { type: true, category: true, amount: true } });
  const sum = (f: (l: (typeof lines)[number]) => boolean) => lines.filter(f).reduce((a, l) => a.plus(l.amount), d(0));
  const social = sum((l) => l.type === "DEDUCTION" && l.category === "SOCIAL");
  const tax = sum((l) => l.type === "DEDUCTION" && l.category === "TAX");
  const other = sum((l) => l.type === "DEDUCTION" && l.category === "OTHER");
  const employer = d(run.totalEmployer);
  const label = `Paie ${String(run.month).padStart(2, "0")}/${run.year}`;
  const out: EntryLineInput[] = [
    { mapping: "payroll_expense", label, debit: run.totalGross },
    ...(employer.gt(0) ? [{ mapping: "payroll_social_expense" as const, label: `Charges patronales — ${label}`, debit: employer }] : []),
    { mapping: "payroll_net_due", label, credit: run.totalNet },
    ...(social.plus(employer).gt(0) ? [{ mapping: "payroll_social_due" as const, label: `Cotisations sociales — ${label}`, credit: social.plus(employer) }] : []),
    ...(tax.gt(0) ? [{ mapping: "payroll_tax_due" as const, label: `Impôt retenu — ${label}`, credit: tax }] : []),
    ...(other.gt(0) ? [{ mapping: "payroll_other_due" as const, label: `Autres retenues — ${label}`, credit: other }] : []),
  ];
  return postEntry(tx, ctx, { journal: "OD", date: new Date(Date.UTC(run.year, run.month, 0)), description: label, reference: label, lines: out, sourceType: "payroll", sourceId: run.id });
}
export const reversePayroll = (tx: Db, ctx: Ctx, runId: string) => reverseSource(tx, ctx, "payroll", runId, toDay(new Date()), "Annulation de la paie");

/** Paiement des salaires : Dr salaires dus / Cr trésorerie du compte payeur. */
export async function postPayrollPaid(tx: Db, ctx: Ctx, runId: string) {
  const run = await tx.payrollRun.findFirstOrThrow({ where: { id: runId } });
  const type = await accountType(tx, run.accountId, null);
  const label = `Paiement des salaires ${String(run.month).padStart(2, "0")}/${run.year}`;
  return postEntry(tx, ctx, {
    journal: TREASURY_JOURNAL[type], date: run.paidAt ?? new Date(), description: label, reference: label, sourceType: "payroll_payment", sourceId: run.id,
    lines: [{ mapping: "payroll_net_due", label, debit: run.totalNet }, { mapping: TREASURY_MAPPING[type], label, credit: run.totalNet }],
  });
}

/** Solde d'ouverture d'un compte de trésorerie : contrepartie 471 (compte d'attente) que l'expert-comptable ventile (capital, report à nouveau…). */
export async function postOpeningBalance(tx: Db, ctx: Ctx, accountId: string) {
  const a = await tx.financeAccount.findFirstOrThrow({ where: { id: accountId } });
  const amount = d(a.openingBalance);
  if (amount.isZero()) return null;
  const label = `Solde d'ouverture — ${a.name}`;
  const treasury = TREASURY_MAPPING[a.type];
  return postEntry(tx, ctx, {
    journal: "AN", date: toDay(new Date()), description: label, sourceType: "opening_balance", sourceId: a.id,
    lines: amount.gt(0)
      ? [{ mapping: treasury, label, debit: amount }, { account: "471", label, credit: amount }]
      : [{ account: "471", label, debit: amount.neg() }, { mapping: treasury, label, credit: amount.neg() }],
  });
}

/** Transfert entre comptes de trésorerie : sans effet comptable si les deux comptes relèvent du même compte comptable. */
export async function postTransfer(tx: Db, ctx: Ctx, groupId: string) {
  const legs = await tx.financialTransaction.findMany({ where: { transferGroupId: groupId }, include: { account: { select: { type: true, name: true } } } });
  const out = legs.find((l) => l.type === "TRANSFER_OUT");
  const inn = legs.find((l) => l.type === "TRANSFER_IN");
  if (!out || !inn) return null;
  const from = TREASURY_MAPPING[out.account.type];
  const to = TREASURY_MAPPING[inn.account.type];
  if (from === to) return null;
  const label = out.description;
  return postEntry(tx, ctx, {
    journal: "OD", date: out.date, description: label, sourceType: "transfer", sourceId: groupId,
    lines: [{ mapping: to, label, debit: out.amount }, { mapping: from, label, credit: out.amount }],
  });
}
export const reverseTransfer = (tx: Db, ctx: Ctx, groupId: string) => reverseSource(tx, ctx, "transfer", groupId, toDay(new Date()), "Annulation de transfert");
