import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, notFound } from "@/core/errors";
import { d, roundMoney, type Decimal } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import { MAPPING_KEYS, createFiscalYear as buildFiscalYear, ensureAccountingDefaults, type MappingKey } from "./chart";
import { postEntry, toDay } from "./engine";
import * as posting from "./posting";
import type { fiscalYearSchema, ledgerAccountSchema, manualEntrySchema, mappingSchema, updateLedgerAccountSchema, updateManualEntrySchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const DAY = 86_400_000;
const iso = (v: Date) => v.toISOString().slice(0, 10);

// ═══ Plan comptable ═══════════════════════════════════════════

/** Garantit le plan par défaut (première utilisation du module sur une entreprise existante). */
export async function ensureChart(ctx: Ctx) {
  if ((await ctx.db.ledgerAccount.count()) === 0) await ctx.tx((tx) => ensureAccountingDefaults(tx, ctx.company.id));
}

export async function listLedgerAccounts(ctx: Ctx, opts: { q?: string; accountClass?: number; includeInactive?: boolean } = {}) {
  const where = {
    ...(opts.includeInactive ? {} : { isActive: true }),
    ...(opts.accountClass ? { class: opts.accountClass } : {}),
    ...(opts.q ? { OR: [{ code: { startsWith: opts.q } }, { name: { contains: opts.q, mode: "insensitive" as const } }] } : {}),
  };
  return ctx.db.ledgerAccount.findMany({ where, orderBy: { code: "asc" } });
}

export async function createLedgerAccount(ctx: Ctx, input: z.output<typeof ledgerAccountSchema>) {
  if (await ctx.db.ledgerAccount.findFirst({ where: { code: input.code } })) throw businessRule(`Le compte ${input.code} existe déjà.`);
  const a = await ctx.db.ledgerAccount.create({ data: { companyId: ctx.company.id, code: input.code, name: input.name.trim(), class: Number(input.code[0]) } });
  await audit(ctx, { action: "accounting.account.create", resource: "LedgerAccount", resourceId: a.id, summary: `${ctx.user.name} a créé le compte ${a.code} « ${a.name} ».` });
  return a;
}

export async function updateLedgerAccount(ctx: Ctx, input: z.output<typeof updateLedgerAccountSchema>) {
  const a = await ctx.db.ledgerAccount.findFirst({ where: { id: input.id } });
  if (!a) throw notFound("Compte");
  if (!input.isActive) {
    const used = await ctx.db.accountMapping.findFirst({ where: { ledgerAccountId: a.id } });
    if (used) throw businessRule(`Le compte ${a.code} est utilisé par la correspondance « ${MAPPING_KEYS[used.key as MappingKey]?.label ?? used.key} » : changez-la d'abord.`);
  }
  const after = await ctx.db.ledgerAccount.update({ where: { id: a.id }, data: { name: input.name.trim(), isActive: input.isActive } });
  await audit(ctx, { action: "accounting.account.update", resource: "LedgerAccount", resourceId: a.id, summary: `${ctx.user.name} a modifié le compte ${a.code}.`, before: { name: a.name, isActive: a.isActive }, after: { name: after.name, isActive: after.isActive } });
  return after;
}

export async function listMappings(ctx: Ctx) {
  await ensureChart(ctx);
  const rows = await ctx.db.accountMapping.findMany({ include: { ledgerAccount: { select: { id: true, code: true, name: true } } } });
  return (Object.keys(MAPPING_KEYS) as MappingKey[]).map((key) => ({ key, label: MAPPING_KEYS[key].label, expectedClass: Number(MAPPING_KEYS[key].code[0]), account: rows.find((r) => r.key === key)?.ledgerAccount ?? null }));
}

export async function setMapping(ctx: Ctx, input: z.output<typeof mappingSchema>) {
  const key = input.key as MappingKey;
  const account = await ctx.db.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, isActive: true } });
  if (!account) throw notFound("Compte");
  const expected = Number(MAPPING_KEYS[key].code[0]);
  if (account.class !== expected) throw businessRule(`« ${MAPPING_KEYS[key].label} » doit pointer vers un compte de classe ${expected}.`);
  await ctx.db.accountMapping.upsert({ where: { companyId_key: { companyId: ctx.company.id, key } }, create: { companyId: ctx.company.id, key, ledgerAccountId: account.id }, update: { ledgerAccountId: account.id } });
  await audit(ctx, { action: "accounting.mapping.set", resource: "AccountMapping", resourceId: key, summary: `${ctx.user.name} a rattaché « ${MAPPING_KEYS[key].label} » au compte ${account.code} « ${account.name} ».` });
}

// ═══ Exercices et périodes ════════════════════════════════════

export async function listFiscalYears(ctx: Ctx) {
  await ensureChart(ctx);
  return ctx.db.fiscalYear.findMany({ orderBy: { startDate: "desc" }, include: { periods: { orderBy: { startDate: "asc" } } } });
}

export async function createFiscalYear(ctx: Ctx, input: z.output<typeof fiscalYearSchema>) {
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  if (!start || !end) throw businessRule("Dates invalides.");
  const s = toDay(start), e = toDay(end);
  if (e <= s) throw businessRule("La fin de l'exercice doit suivre son début.");
  if ((e.getTime() - s.getTime()) / DAY > 550) throw businessRule("Un exercice ne peut pas dépasser 18 mois.");
  if (await ctx.db.fiscalYear.findFirst({ where: { name: input.name.trim() } })) throw businessRule("Un exercice porte déjà ce nom.");
  if (await ctx.db.fiscalYear.findFirst({ where: { startDate: { lte: e }, endDate: { gte: s } } })) throw businessRule("Cet exercice chevauche un exercice existant.");
  const fy = await ctx.tx((tx) => buildFiscalYear(tx, ctx.company.id, input.name.trim(), s, e));
  await audit(ctx, { action: "accounting.year.create", resource: "FiscalYear", resourceId: fy.id, summary: `${ctx.user.name} a créé l'exercice « ${fy.name} » (${iso(s)} → ${iso(e)}).` });
  return fy;
}

export async function setPeriodLocked(ctx: Ctx, id: string, locked: boolean) {
  const p = await ctx.db.accountingPeriod.findFirst({ where: { id }, include: { fiscalYear: true } });
  if (!p) throw notFound("Période");
  if (p.fiscalYear.status === "CLOSED") throw businessRule("L'exercice est clôturé : ses périodes ne peuvent plus être modifiées.");
  await ctx.db.accountingPeriod.update({ where: { id }, data: { status: locked ? "LOCKED" : "OPEN" } });
  await audit(ctx, { action: locked ? "accounting.period.lock" : "accounting.period.unlock", resource: "AccountingPeriod", resourceId: id, summary: `${ctx.user.name} a ${locked ? "verrouillé" : "rouvert"} la période du ${iso(p.startDate)} au ${iso(p.endDate)}.` });
}

type Balances = Map<string, { code: string; class: number; net: Decimal }>;

/** Soldes (débit − crédit) par compte pour les écritures validées d'un exercice. */
async function yearBalances(tx: Db, companyId: string, fiscalYearId: string): Promise<Balances> {
  const sums = await tx.journalLine.groupBy({ by: ["ledgerAccountId"], where: { entry: { fiscalYearId, status: "POSTED" } }, _sum: { debit: true, credit: true } });
  const accounts = await tx.ledgerAccount.findMany({ where: { companyId, id: { in: sums.map((s) => s.ledgerAccountId) } } });
  const info = new Map(accounts.map((a) => [a.id, a]));
  const out: Balances = new Map();
  for (const s of sums) {
    const a = info.get(s.ledgerAccountId)!;
    const net = d(s._sum.debit ?? 0).minus(s._sum.credit ?? 0);
    if (!net.isZero()) out.set(a.id, { code: a.code, class: a.class, net });
  }
  return out;
}

/**
 * Clôture d'un exercice : écriture de solde des comptes de gestion (classes 6, 7, 8) vers le résultat (131 bénéfice / 139 perte),
 * écriture d'à-nouveaux dans l'exercice suivant (créé si besoin) pour les comptes de bilan (classes 1 à 5), puis verrouillage définitif.
 * L'affectation du résultat (réserves, report à nouveau, dividendes) reste une opération diverse manuelle.
 */
export async function closeFiscalYear(ctx: Ctx, id: string) {
  const fy = await ctx.db.fiscalYear.findFirst({ where: { id } });
  if (!fy) throw notFound("Exercice");
  if (fy.status === "CLOSED") throw businessRule("Cet exercice est déjà clôturé.");
  const earlier = await ctx.db.fiscalYear.findFirst({ where: { endDate: { lt: fy.startDate }, status: "OPEN" } });
  if (earlier) throw businessRule(`Clôturez d'abord l'exercice « ${earlier.name} » (les exercices se clôturent dans l'ordre).`);
  if ((await ctx.db.journalEntry.count({ where: { fiscalYearId: id, status: "DRAFT" } })) > 0) throw businessRule("Des écritures sont encore en brouillon : validez-les ou supprimez-les avant la clôture.");

  const result = await ctx.tx(async (tx) => {
    // 1. solde des comptes de gestion
    const before = await yearBalances(tx, ctx.company.id, id);
    const mgmt = [...before.entries()].filter(([, b]) => b.class >= 6);
    let profit = d(0);
    const closingLines = mgmt.map(([, b]) => { profit = profit.minus(b.net); return b.net.gt(0) ? { account: b.code, label: "Solde du compte de gestion", credit: b.net } : { account: b.code, label: "Solde du compte de gestion", debit: b.net.neg() }; });
    if (closingLines.length > 0 && !profit.isZero()) {
      closingLines.push(profit.gt(0) ? ({ mapping: "result_profit", label: "Résultat de l'exercice", credit: profit } as never) : ({ mapping: "result_loss", label: "Résultat de l'exercice", debit: profit.neg() } as never));
      await postEntry(tx, ctx, { journal: "OD", date: fy.endDate, description: `Clôture de l'exercice ${fy.name} — détermination du résultat`, reference: `CLOTURE-${fy.name}`, lines: closingLines as never, sourceType: "year_close", sourceId: fy.id, allowInactive: true });
    }

    // 2. à-nouveaux dans l'exercice suivant
    const after = await yearBalances(tx, ctx.company.id, id);
    const carry = [...after.values()].filter((b) => b.class <= 5);
    const nextStart = new Date(fy.endDate.getTime() + DAY);
    let next = await tx.fiscalYear.findFirst({ where: { companyId: ctx.company.id, startDate: { lte: nextStart }, endDate: { gte: nextStart } } });
    if (!next) {
      const nextEnd = new Date(Date.UTC(nextStart.getUTCFullYear() + 1, nextStart.getUTCMonth(), 0));
      next = await buildFiscalYear(tx, ctx.company.id, String(nextEnd.getUTCFullYear()), nextStart, nextEnd);
    }
    if (carry.length > 0) {
      await postEntry(tx, ctx, {
        journal: "AN", date: next.startDate, description: `À-nouveaux de l'exercice ${next.name} (reprise des soldes de ${fy.name})`, reference: `AN-${next.name}`, sourceType: "year_open", sourceId: fy.id, allowInactive: true,
        lines: carry.map((b) => (b.net.gt(0) ? { account: b.code, label: "Solde repris", debit: b.net } : { account: b.code, label: "Solde repris", credit: b.net.neg() })),
      });
    }
    await tx.accountingPeriod.updateMany({ where: { fiscalYearId: id }, data: { status: "LOCKED" } });
    await tx.fiscalYear.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.user.id } });
    return { profit, nextName: next.name };
  });
  await audit(ctx, { action: "accounting.year.close", resource: "FiscalYear", resourceId: id, summary: `${ctx.user.name} a clôturé l'exercice « ${fy.name} » (résultat : ${formatMoney(result.profit.toNumber(), ctx.company.currency)}).` });
  return { profit: result.profit.toNumber(), nextYear: result.nextName };
}

// ═══ Écritures manuelles ══════════════════════════════════════

async function findPeriodLoose(tx: Db, companyId: string, date: Date) {
  const day = toDay(date);
  let p = await tx.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: day }, endDate: { gte: day } } });
  if (!p) {
    const { ensureCalendarYear } = await import("./chart");
    await ensureCalendarYear(tx, companyId, day.getUTCFullYear());
    p = await tx.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: day }, endDate: { gte: day } } });
  }
  if (!p) throw businessRule("Aucun exercice ne couvre cette date.");
  return p;
}

async function checkEntryLines(ctx: Ctx, lines: { ledgerAccountId: string; debit: number; credit: number }[]) {
  const ids = [...new Set(lines.map((l) => l.ledgerAccountId))];
  const found = await ctx.db.ledgerAccount.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  if (found.length !== ids.length) throw notFound("Compte comptable");
  for (const l of lines) {
    if (l.debit > 0 && l.credit > 0) throw businessRule("Une ligne est au débit ou au crédit, pas les deux.");
    if (!(l.debit > 0 || l.credit > 0)) throw businessRule("Chaque ligne doit porter un montant.");
  }
}

export async function listJournals(ctx: Ctx) {
  await ensureChart(ctx);
  return ctx.db.journal.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
}

export async function createManualEntry(ctx: Ctx, input: z.output<typeof manualEntrySchema>) {
  const journal = await ctx.db.journal.findFirst({ where: { id: input.journalId, isActive: true } });
  if (!journal) throw notFound("Journal");
  if (journal.type === "OPENING") throw businessRule("Le journal des à-nouveaux est alimenté par la clôture.");
  await checkEntryLines(ctx, input.lines);
  const date = parseDate(input.date) ?? new Date();
  const entry = await ctx.tx(async (tx) => {
    const period = await findPeriodLoose(tx, ctx.company.id, date);
    const id = crypto.randomUUID();
    return tx.journalEntry.create({
      data: {
        id, companyId: ctx.company.id, number: `BRO-${id.slice(0, 8)}`, journalId: journal.id, fiscalYearId: period.fiscalYearId, periodId: period.id, date: toDay(date), reference: blank(input.reference), description: input.description.trim(), createdById: ctx.user.id,
        lines: { create: input.lines.map((l, i) => ({ companyId: ctx.company.id, position: i, ledgerAccountId: l.ledgerAccountId, label: l.label.trim(), debit: roundMoney(l.debit, ctx.company.currency).toString(), credit: roundMoney(l.credit, ctx.company.currency).toString() })) },
      },
    });
  });
  await audit(ctx, { action: "accounting.entry.create", resource: "JournalEntry", resourceId: entry.id, summary: `${ctx.user.name} a saisi un brouillon d'écriture « ${entry.description} ».` });
  return entry;
}

async function getDraft(ctx: Ctx, id: string) {
  const e = await ctx.db.journalEntry.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, journal: true } });
  if (!e) throw notFound("Écriture");
  if (e.status !== "DRAFT") throw businessRule("Une écriture validée est immuable : utilisez la contre-passation.");
  if (e.sourceType) throw businessRule("Cette écriture est générée par un document.");
  return e;
}

export async function updateManualEntry(ctx: Ctx, input: z.output<typeof updateManualEntrySchema>) {
  const e = await getDraft(ctx, input.id);
  const journal = await ctx.db.journal.findFirst({ where: { id: input.journalId, isActive: true } });
  if (!journal || journal.type === "OPENING") throw notFound("Journal");
  await checkEntryLines(ctx, input.lines);
  const date = parseDate(input.date) ?? e.date;
  await ctx.tx(async (tx) => {
    const period = await findPeriodLoose(tx, ctx.company.id, date);
    await tx.journalLine.deleteMany({ where: { entryId: e.id } });
    await tx.journalEntry.update({
      where: { id: e.id },
      data: {
        journalId: journal.id, fiscalYearId: period.fiscalYearId, periodId: period.id, date: toDay(date), reference: blank(input.reference), description: input.description.trim(),
        lines: { create: input.lines.map((l, i) => ({ companyId: ctx.company.id, position: i, ledgerAccountId: l.ledgerAccountId, label: l.label.trim(), debit: roundMoney(l.debit, ctx.company.currency).toString(), credit: roundMoney(l.credit, ctx.company.currency).toString() })) },
      },
    });
  });
  await audit(ctx, { action: "accounting.entry.update", resource: "JournalEntry", resourceId: e.id, summary: `${ctx.user.name} a modifié le brouillon « ${input.description} ».` });
}

export async function deleteManualEntry(ctx: Ctx, id: string) {
  const e = await getDraft(ctx, id);
  await ctx.db.journalEntry.delete({ where: { id } });
  await audit(ctx, { action: "accounting.entry.delete", resource: "JournalEntry", resourceId: id, summary: `${ctx.user.name} a supprimé le brouillon d'écriture « ${e.description} ».` });
}

/** Validation : équilibre, période ouverte, numéro séquentiel attribué à ce moment (pas de trou dans la numérotation). */
export async function validateManualEntry(ctx: Ctx, id: string) {
  const e = await getDraft(ctx, id);
  const debit = e.lines.reduce((a, l) => a.plus(l.debit), d(0));
  const credit = e.lines.reduce((a, l) => a.plus(l.credit), d(0));
  if (debit.lte(0) || !debit.eq(credit)) throw businessRule(`Écriture déséquilibrée : débit ${debit.toString()} ≠ crédit ${credit.toString()}.`);
  const number = await ctx.tx(async (tx) => {
    const period = await tx.accountingPeriod.findFirstOrThrow({ where: { id: e.periodId }, include: { fiscalYear: true } });
    if (period.fiscalYear.status === "CLOSED") throw businessRule(`L'exercice ${period.fiscalYear.name} est clôturé.`);
    if (period.status === "LOCKED") throw businessRule("La période de cette écriture est verrouillée.");
    const n = await nextNumber(tx, ctx.company.id, "journal_entry", e.date);
    await tx.journalEntry.update({ where: { id }, data: { number: n, status: "POSTED", postedAt: new Date(), postedById: ctx.user.id } });
    return n;
  });
  await audit(ctx, { action: "accounting.entry.validate", resource: "JournalEntry", resourceId: id, summary: `${ctx.user.name} a validé l'écriture ${number} « ${e.description} ».` });
  return { number };
}

/** Contre-passation d'une écriture manuelle validée (les écritures de documents se corrigent en annulant le document). */
export async function reverseManualEntry(ctx: Ctx, id: string) {
  const e = await ctx.db.journalEntry.findFirst({ where: { id }, include: { lines: true, journal: true } });
  if (!e) throw notFound("Écriture");
  if (e.status !== "POSTED") throw businessRule("Seule une écriture validée se contre-passe.");
  if (e.sourceType) throw businessRule("Cette écriture est générée par un document : annulez le document pour la contre-passer.");
  if (e.reversalOfId) throw businessRule("Cette écriture est déjà une contre-passation.");
  const { reverseEntryRecord } = await import("./engine");
  const rev = await ctx.tx((tx) => reverseEntryRecord(tx, ctx, e, "manual:reversal", e.id, toDay(new Date())));
  await audit(ctx, { action: "accounting.entry.reverse", resource: "JournalEntry", resourceId: id, summary: `${ctx.user.name} a contre-passé l'écriture ${e.number} (${rev.number}).` });
  return rev;
}

// ═══ Rattrapage ═══════════════════════════════════════════════

/**
 * Génère les écritures des documents antérieurs à l'activation du module Comptabilité (ou bloqués par une période verrouillée) :
 * factures, avoirs, encaissements, factures et règlements fournisseurs, dépenses payées, mouvements saisis et transferts.
 * Idempotent : un document déjà comptabilisé est ignoré. Chaque document est traité dans sa propre transaction.
 */
export async function generateMissingEntries(ctx: Ctx) {
  await ensureChart(ctx);
  const existing = async (type: string) => new Set((await ctx.db.journalEntry.findMany({ where: { sourceType: type }, select: { sourceId: true } })).map((e) => e.sourceId));
  const stats = { created: 0, errors: [] as string[] };
  const run = async (label: string, fn: (tx: Db) => Promise<unknown>) => {
    try { await ctx.tx(async (tx) => { await fn(tx); }); stats.created++; } catch (e) { stats.errors.push(`${label} : ${e instanceof Error ? e.message : "erreur"}`); }
  };

  const doneInv = await existing("invoice");
  for (const i of await ctx.db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, select: { id: true, number: true }, orderBy: { issueDate: "asc" } })) if (!doneInv.has(i.id)) await run(`Facture ${i.number}`, (tx) => posting.postInvoice(tx, ctx, i.id));
  const doneCn = await existing("credit_note");
  for (const c of await ctx.db.creditNote.findMany({ where: { status: "ISSUED" }, select: { id: true, number: true } })) if (!doneCn.has(c.id)) await run(`Avoir ${c.number}`, (tx) => posting.postCreditNote(tx, ctx, c.id));
  const donePay = await existing("payment");
  for (const p of await ctx.db.payment.findMany({ where: { direction: "IN", status: "VALIDATED" }, select: { id: true, number: true }, orderBy: { date: "asc" } })) if (!donePay.has(p.id)) await run(`Encaissement ${p.number}`, (tx) => posting.postCustomerPayment(tx, ctx, p.id));
  const doneBill = await existing("supplier_bill");
  for (const b of await ctx.db.supplierBill.findMany({ where: { status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, select: { id: true, number: true }, orderBy: { billDate: "asc" } })) if (!doneBill.has(b.id)) await run(`Facture fournisseur ${b.number}`, (tx) => posting.postSupplierBill(tx, ctx, b.id));
  const doneSp = await existing("supplier_payment");
  for (const p of await ctx.db.payment.findMany({ where: { direction: "OUT", status: "VALIDATED" }, select: { id: true, number: true }, orderBy: { date: "asc" } })) if (!doneSp.has(p.id)) await run(`Règlement ${p.number}`, (tx) => posting.postSupplierPayment(tx, ctx, p.id));
  const doneEx = await existing("expense");
  for (const e of await ctx.db.expense.findMany({ where: { status: "PAID" }, select: { id: true, number: true }, orderBy: { date: "asc" } })) if (!doneEx.has(e.id)) await run(`Dépense ${e.number}`, (tx) => posting.postExpense(tx, ctx, e.id));
  const doneMt = await existing("manual_transaction");
  for (const t of await ctx.db.financialTransaction.findMany({ where: { status: "VALID", sourceType: "manual" }, select: { id: true, description: true }, orderBy: { date: "asc" } })) if (!doneMt.has(t.id)) await run(`Mouvement « ${t.description} »`, (tx) => posting.postManualTransaction(tx, ctx, t.id));
  const doneOb = await existing("opening_balance");
  for (const a of await ctx.db.financeAccount.findMany({ where: { deletedAt: null, NOT: { openingBalance: 0 } }, select: { id: true, name: true } })) if (!doneOb.has(a.id)) await run(`Solde d'ouverture « ${a.name} »`, (tx) => posting.postOpeningBalance(tx, ctx, a.id));
  const doneTf = await existing("transfer");
  for (const t of await ctx.db.financialTransaction.findMany({ where: { status: "VALID", sourceType: "transfer", type: "TRANSFER_OUT" }, select: { transferGroupId: true, description: true }, orderBy: { date: "asc" } })) if (t.transferGroupId && !doneTf.has(t.transferGroupId)) await run(`Transfert « ${t.description} »`, (tx) => posting.postTransfer(tx, ctx, t.transferGroupId!));
  await audit(ctx, { action: "accounting.backfill", resource: "JournalEntry", summary: `${ctx.user.name} a généré les écritures manquantes (${stats.created} traitées, ${stats.errors.length} erreur(s)).` });
  return stats;
}
