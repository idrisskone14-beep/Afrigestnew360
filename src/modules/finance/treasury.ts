import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { d, roundMoney, type Decimal, type Numeric } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import type { accountSchema, manualTransactionSchema, transferSchema, updateAccountSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const IN_TYPES = ["IN", "TRANSFER_IN"] as const;

// ═══ Soldes ═══════════════════════════════════════════════════

/** Solde = solde d'ouverture + entrées − sorties (mouvements valides uniquement). */
export async function accountBalances(db: Pick<Db, "financialTransaction" | "financeAccount">, accountIds?: string[]) {
  const accounts = await db.financeAccount.findMany({ where: { ...(accountIds ? { id: { in: accountIds } } : {}) }, select: { id: true, openingBalance: true } });
  const sums = await db.financialTransaction.groupBy({ by: ["accountId", "type"], where: { status: "VALID", ...(accountIds ? { accountId: { in: accountIds } } : {}) }, _sum: { amount: true } });
  const out = new Map<string, Decimal>();
  for (const a of accounts) out.set(a.id, d(a.openingBalance));
  for (const s of sums) {
    const cur = out.get(s.accountId);
    if (cur === undefined) continue;
    out.set(s.accountId, (IN_TYPES as readonly string[]).includes(s.type) ? cur.plus(s._sum.amount ?? 0) : cur.minus(s._sum.amount ?? 0));
  }
  return out;
}

export async function listAccounts(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  const accounts = await ctx.db.financeAccount.findMany({ where: { deletedAt: null, ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: [{ type: "asc" }, { name: "asc" }] });
  const balances = await accountBalances(ctx.db);
  return accounts.map((a) => ({ ...a, balance: balances.get(a.id) ?? d(0) }));
}

export async function getAccount(ctx: Ctx, id: string) {
  const a = await ctx.db.financeAccount.findFirst({ where: { id, deletedAt: null } });
  if (!a) throw notFound("Compte");
  return { ...a, balance: (await accountBalances(ctx.db, [id])).get(id) ?? d(0) };
}

export async function treasuryTotal(ctx: Pick<Ctx, "db">) {
  const accounts = await ctx.db.financeAccount.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });
  const balances = await accountBalances(ctx.db, accounts.map((a) => a.id));
  return [...balances.values()].reduce((a, b) => a.plus(b), d(0));
}

/**
 * Compte à créditer/débiter : celui choisi (actif, de l'entreprise) sinon le compte par défaut du type
 * correspondant au mode de paiement, sinon n'importe quel compte actif. `null` si aucun compte n'existe.
 */
export async function resolveAccount(db: Pick<Db, "financeAccount">, opts: { accountId?: string | null; method?: string | null }) {
  if (opts.accountId) {
    const a = await db.financeAccount.findFirst({ where: { id: opts.accountId, deletedAt: null, isActive: true } });
    if (!a) throw notFound("Compte");
    return a;
  }
  const type = opts.method === "CASH" ? "CASH" : opts.method === "MOBILE_MONEY" ? "MOBILE_MONEY" : "BANK";
  const accounts = await db.financeAccount.findMany({ where: { deletedAt: null, isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return accounts.find((a) => a.type === type) ?? accounts[0] ?? null;
}

/** Vérifie un compte choisi par l'utilisateur (jamais d'identifiant d'une autre entreprise). */
export async function assertAccount(db: Pick<Db, "financeAccount">, accountId?: string | null) {
  if (accountId) await resolveAccount(db, { accountId });
}

async function lockAccount(tx: Db, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

/** Une caisse ou un compte mobile money ne peut pas être négatif (un compte bancaire peut être à découvert). */
async function assertFunds(tx: Db, account: { id: string; name: string; type: string; currency: string }, outflow: Decimal) {
  if (account.type === "BANK") return;
  const balance = (await accountBalances(tx, [account.id])).get(account.id) ?? d(0);
  if (balance.lt(outflow)) throw businessRule(`Solde insuffisant sur « ${account.name} » (disponible : ${formatMoney(balance.toNumber(), account.currency)}).`);
}

// ═══ Mouvements ═══════════════════════════════════════════════

export interface NewTransaction {
  accountId: string;
  type: "IN" | "OUT" | "TRANSFER_IN" | "TRANSFER_OUT";
  date: Date;
  amount: Numeric;
  description: string;
  reference?: string | null;
  categoryId?: string | null;
  sourceType?: string;
  sourceId?: string;
  transferGroupId?: string;
}

/** Enregistre un mouvement dans la transaction courante (verrou du compte + contrôle du solde pour les sorties). */
export async function recordTransaction(tx: Db, ctx: Pick<Ctx, "company" | "user">, t: NewTransaction) {
  const account = await tx.financeAccount.findFirst({ where: { id: t.accountId, deletedAt: null } });
  if (!account) throw notFound("Compte");
  if (!account.isActive) throw businessRule(`Le compte « ${account.name} » est désactivé.`);
  const amount = roundMoney(t.amount, account.currency);
  if (amount.lte(0)) throw businessRule("Le montant doit être positif.");
  await lockAccount(tx, account.id);
  if (t.type === "OUT" || t.type === "TRANSFER_OUT") await assertFunds(tx, account, amount);
  return tx.financialTransaction.create({
    data: {
      companyId: ctx.company.id, accountId: account.id, type: t.type, date: t.date, amount: amount.toString(), currency: account.currency, categoryId: t.categoryId ?? null,
      description: t.description, reference: blank(t.reference), sourceType: t.sourceType ?? null, sourceId: t.sourceId ?? null, transferGroupId: t.transferGroupId ?? null, createdById: ctx.user.id,
    },
  });
}

/** Annule les mouvements valides issus d'un document (paiement annulé, dépense annulée…). */
export async function cancelTransactionsOf(tx: Db, sourceType: string, sourceId: string) {
  await tx.financialTransaction.updateMany({ where: { sourceType, sourceId, status: "VALID" }, data: { status: "CANCELLED" } });
}

export async function listTransactions(ctx: Ctx, p: { q?: string; accountId?: string; type?: string; from?: Date; to?: Date; includeCancelled?: boolean; skip: number; take: number }) {
  const where = {
    ...(p.includeCancelled ? {} : { status: "VALID" as const }),
    ...(p.accountId ? { accountId: p.accountId } : {}),
    ...(p.type ? { type: p.type as never } : {}),
    ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
    ...(p.q ? { OR: [{ description: { contains: p.q, mode: "insensitive" as const } }, { reference: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.financialTransaction.count({ where }),
    ctx.db.financialTransaction.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { account: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}

/** Saisie manuelle d'un encaissement/décaissement hors document (apport, frais divers…). */
export async function createManualTransaction(ctx: Ctx, input: z.output<typeof manualTransactionSchema>) {
  if (input.categoryId) {
    const cat = await ctx.db.financeCategory.findFirst({ where: { id: input.categoryId, isActive: true } });
    if (!cat) throw notFound("Catégorie");
    if ((cat.kind === "INCOME") !== (input.type === "IN")) throw businessRule("La catégorie ne correspond pas au sens du mouvement.");
  }
  const t = await ctx.tx(async (tx) => {
    const created = await recordTransaction(tx, ctx, { accountId: input.accountId, type: input.type, date: parseDate(input.date) ?? new Date(), amount: input.amount, description: input.description.trim(), reference: input.reference, categoryId: input.categoryId || null, sourceType: "manual", sourceId: undefined });
    await emit(tx, ctx, "finance.manual_transaction.created", { transactionId: created.id });
    return created;
  });
  await audit(ctx, { action: "finance.transaction.create", resource: "FinancialTransaction", resourceId: t.id, summary: `${ctx.user.name} a saisi ${input.type === "IN" ? "une entrée" : "une sortie"} de ${formatMoney(d(t.amount).toNumber(), t.currency)} : ${t.description}.`, after: { type: t.type, amount: t.amount } });
  return t;
}

export async function createTransfer(ctx: Ctx, input: z.output<typeof transferSchema>) {
  if (input.fromAccountId === input.toAccountId) throw businessRule("Choisissez deux comptes différents.");
  const [from, to] = await Promise.all([resolveAccount(ctx.db, { accountId: input.fromAccountId }), resolveAccount(ctx.db, { accountId: input.toAccountId })]);
  if (!from || !to) throw notFound("Compte");
  if (from.currency !== to.currency) throw businessRule("Le transfert entre comptes de devises différentes n'est pas pris en charge.");
  const groupId = crypto.randomUUID();
  const date = parseDate(input.date) ?? new Date();
  const label = blank(input.description) ?? `Transfert ${from.name} → ${to.name}`;
  await ctx.tx(async (tx) => {
    await recordTransaction(tx, ctx, { accountId: from.id, type: "TRANSFER_OUT", date, amount: input.amount, description: label, sourceType: "transfer", transferGroupId: groupId });
    await recordTransaction(tx, ctx, { accountId: to.id, type: "TRANSFER_IN", date, amount: input.amount, description: label, sourceType: "transfer", transferGroupId: groupId });
    await emit(tx, ctx, "finance.transfer.created", { groupId });
  });
  await audit(ctx, { action: "finance.transfer", resource: "FinancialTransaction", resourceId: groupId, summary: `${ctx.user.name} a transféré ${formatMoney(roundMoney(input.amount, from.currency).toNumber(), from.currency)} de « ${from.name} » vers « ${to.name} ».` });
  return { groupId };
}

/** Annule une saisie manuelle ou un transfert (les mouvements issus de documents s'annulent via leur document). */
export async function cancelTransaction(ctx: Ctx, id: string) {
  const t = await ctx.db.financialTransaction.findFirst({ where: { id } });
  if (!t) throw notFound("Mouvement");
  if (t.status === "CANCELLED") throw businessRule("Ce mouvement est déjà annulé.");
  if (t.sourceType !== "manual" && t.sourceType !== "transfer") throw businessRule("Ce mouvement provient d'un document : annulez le document (paiement, dépense) pour l'annuler.");
  if (t.reconciledAt) throw businessRule("Ce mouvement est rapproché : retirez d'abord le rapprochement.");
  await ctx.tx(async (tx) => {
    const group = t.transferGroupId ? await tx.financialTransaction.findMany({ where: { transferGroupId: t.transferGroupId, status: "VALID" } }) : [t];
    // retirer une entrée ne doit pas rendre une caisse négative
    for (const leg of group) {
      if (!(IN_TYPES as readonly string[]).includes(leg.type)) continue;
      const account = await tx.financeAccount.findFirstOrThrow({ where: { id: leg.accountId } });
      await lockAccount(tx, account.id);
      await assertFunds(tx, account, d(leg.amount));
    }
    await tx.financialTransaction.updateMany({ where: { id: { in: group.map((g) => g.id) } }, data: { status: "CANCELLED" } });
    if (t.transferGroupId) await emit(tx, ctx, "finance.transfer.cancelled", { groupId: t.transferGroupId });
    else await emit(tx, ctx, "finance.manual_transaction.cancelled", { transactionId: t.id });
  });
  await audit(ctx, { action: "finance.transaction.cancel", resource: "FinancialTransaction", resourceId: id, summary: `${ctx.user.name} a annulé le mouvement « ${t.description} » (${formatMoney(d(t.amount).toNumber(), t.currency)}).` });
}

export async function setReconciled(ctx: Ctx, id: string, reconciled: boolean) {
  const t = await ctx.db.financialTransaction.findFirst({ where: { id, status: "VALID" } });
  if (!t) throw notFound("Mouvement");
  await ctx.db.financialTransaction.update({ where: { id }, data: { reconciledAt: reconciled ? new Date() : null } });
  await audit(ctx, { action: reconciled ? "finance.reconcile" : "finance.unreconcile", resource: "FinancialTransaction", resourceId: id, summary: `${ctx.user.name} a ${reconciled ? "rapproché" : "retiré le rapprochement de"} « ${t.description} ».` });
}

// ═══ Comptes ══════════════════════════════════════════════════

async function onlyDefaultOfType(tx: Db, companyId: string, type: "BANK" | "CASH" | "MOBILE_MONEY", id: string) {
  await tx.financeAccount.updateMany({ where: { companyId, type, id: { not: id }, isDefault: true }, data: { isDefault: false } });
}

export async function createAccount(ctx: Ctx, input: z.output<typeof accountSchema>) {
  if (await ctx.db.financeAccount.findFirst({ where: { name: input.name.trim(), deletedAt: null } })) throw businessRule("Un compte porte déjà ce nom.");
  const hasType = (await ctx.db.financeAccount.count({ where: { type: input.type, deletedAt: null, isActive: true } })) > 0;
  const account = await ctx.tx(async (tx) => {
    const a = await tx.financeAccount.create({
      data: { companyId: ctx.company.id, name: input.name.trim(), type: input.type, currency: ctx.company.currency, bankName: blank(input.bankName), accountNumber: blank(input.accountNumber), openingBalance: roundMoney(input.openingBalance, ctx.company.currency).toString(), isDefault: input.isDefault || !hasType },
    });
    if (a.isDefault) await onlyDefaultOfType(tx, ctx.company.id, a.type, a.id);
    if (!d(a.openingBalance).isZero()) await emit(tx, ctx, "finance.account.opening_balance", { accountId: a.id });
    return a;
  });
  await audit(ctx, { action: "finance.account.create", resource: "FinanceAccount", resourceId: account.id, summary: `${ctx.user.name} a créé le compte « ${account.name} ».`, after: { type: account.type } });
  return account;
}

export async function updateAccount(ctx: Ctx, input: z.output<typeof updateAccountSchema>) {
  const before = await getAccount(ctx, input.id);
  const dup = await ctx.db.financeAccount.findFirst({ where: { name: input.name.trim(), deletedAt: null, id: { not: input.id } } });
  if (dup) throw businessRule("Un compte porte déjà ce nom.");
  const newOpening = roundMoney(input.openingBalance, before.currency);
  const openingChanged = !newOpening.eq(before.openingBalance);
  if (openingChanged && (await ctx.db.financialTransaction.count({ where: { accountId: input.id } })) > 0) throw businessRule("Le solde d'ouverture ne peut plus être modifié : des mouvements existent (saisissez un mouvement d'ajustement).");
  if (openingChanged && (await ctx.db.journalEntry.findFirst({ where: { sourceType: "opening_balance", sourceId: input.id }, select: { id: true } }))) throw businessRule("Le solde d'ouverture est déjà comptabilisé : saisissez un mouvement d'ajustement.");
  if (!input.isActive && before.balance.abs().gt(0)) throw businessRule("Un compte ne peut être désactivé que lorsque son solde est nul (transférez le solde d'abord).");
  const after = await ctx.tx(async (tx) => {
    const a = await tx.financeAccount.update({ where: { id: input.id }, data: { name: input.name.trim(), type: before.type, bankName: blank(input.bankName), accountNumber: blank(input.accountNumber), openingBalance: newOpening.toString(), isActive: input.isActive, isDefault: input.isActive ? input.isDefault : false } });
    if (a.isDefault) await onlyDefaultOfType(tx, ctx.company.id, a.type, a.id);
    if (openingChanged && !newOpening.isZero()) await emit(tx, ctx, "finance.account.opening_balance", { accountId: a.id });
    return a;
  });
  await audit(ctx, { action: "finance.account.update", resource: "FinanceAccount", resourceId: after.id, summary: `${ctx.user.name} a modifié le compte « ${after.name} ».` });
  return after;
}

// ═══ Catégories ═══════════════════════════════════════════════

export async function listCategories(ctx: Ctx, opts: { kind?: "INCOME" | "EXPENSE"; includeInactive?: boolean } = {}) {
  return ctx.db.financeCategory.findMany({ where: { ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
}

export async function createCategory(ctx: Ctx, input: { name: string; kind: "INCOME" | "EXPENSE" }) {
  if (await ctx.db.financeCategory.findFirst({ where: { name: input.name.trim(), kind: input.kind } })) throw businessRule("Cette catégorie existe déjà.");
  const c = await ctx.db.financeCategory.create({ data: { companyId: ctx.company.id, name: input.name.trim(), kind: input.kind } });
  await audit(ctx, { action: "finance.category.create", resource: "FinanceCategory", resourceId: c.id, summary: `${ctx.user.name} a créé la catégorie « ${c.name} ».` });
  return c;
}

export async function updateCategory(ctx: Ctx, input: { id: string; name: string; isActive: boolean }) {
  const c = await ctx.db.financeCategory.findFirst({ where: { id: input.id } });
  if (!c) throw notFound("Catégorie");
  if (await ctx.db.financeCategory.findFirst({ where: { name: input.name.trim(), kind: c.kind, id: { not: c.id } } })) throw businessRule("Cette catégorie existe déjà.");
  const after = await ctx.db.financeCategory.update({ where: { id: c.id }, data: { name: input.name.trim(), isActive: input.isActive } });
  await audit(ctx, { action: "finance.category.update", resource: "FinanceCategory", resourceId: c.id, summary: `${ctx.user.name} a modifié la catégorie « ${after.name} ».` });
  return after;
}
