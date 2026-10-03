import "server-only";
import { audit } from "@/core/audit";
import { cancelApprovals, requestApproval, requiresApproval } from "@/core/approvals";
import { parseDate } from "@/core/documents/lines";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { d, roundMoney } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { assertOrgRefs } from "@/modules/org/service";
import { assertProject } from "@/modules/projects/refs";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import type { expenseSchema, payExpenseSchema, updateExpenseSchema } from "./schemas";
import { assertAccount, cancelTransactionsOf, recordTransaction, resolveAccount } from "./treasury";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

export async function listExpenses(ctx: Ctx, p: { q?: string; status?: string; categoryId?: string; mine?: boolean; from?: Date; to?: Date; skip: number; take: number }) {
  const where = {
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.categoryId ? { categoryId: p.categoryId } : {}),
    ...(p.mine ? { createdById: ctx.user.id } : {}),
    ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { description: { contains: p.q, mode: "insensitive" as const } }, { reference: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows, sum] = await Promise.all([
    ctx.db.expense.count({ where }),
    ctx.db.expense.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { category: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } } }),
    ctx.db.expense.aggregate({ where, _sum: { amount: true } }),
  ]);
  return { total, rows, sum: d(sum._sum.amount ?? 0) };
}

export async function getExpense(ctx: Ctx, id: string) {
  const e = await ctx.db.expense.findFirst({ where: { id }, include: { category: true, supplier: { select: { id: true, name: true } }, account: { select: { id: true, name: true } } } });
  if (!e) throw notFound("Dépense");
  return e;
}

async function checkRefs(ctx: Ctx, input: { categoryId: string; supplierId?: string | null; accountId?: string | null; branchId?: string | null; costCenterId?: string | null; projectId?: string | null }) {
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  await assertProject(ctx.db, input.projectId);
  const cat = await ctx.db.financeCategory.findFirst({ where: { id: input.categoryId, kind: "EXPENSE", isActive: true } });
  if (!cat) throw notFound("Catégorie de dépense");
  if (input.supplierId && !(await ctx.db.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null }, select: { id: true } }))) throw notFound("Fournisseur");
  await assertAccount(ctx.db, input.accountId);
}

function assertOwnerOrManager(ctx: Ctx, createdById: string) {
  if (createdById !== ctx.user.id && !ctx.can("finance.expense.approve") && !ctx.access.isAdmin) throw forbidden("Seul l'auteur de la dépense peut la modifier.");
}

export async function createExpense(ctx: Ctx, input: z.output<typeof expenseSchema>) {
  await checkRefs(ctx, input);
  const date = parseDate(input.date) ?? new Date();
  const amount = roundMoney(input.amount, ctx.company.currency);
  const e = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "expense", date);
    return tx.expense.create({
      data: { companyId: ctx.company.id, number, date, categoryId: input.categoryId, supplierId: input.supplierId || null, description: input.description.trim(), amount: amount.toString(), currency: ctx.company.currency, method: input.method, accountId: input.accountId || null, reference: blank(input.reference), notes: blank(input.notes), branchId: input.branchId || null, costCenterId: input.costCenterId || null, projectId: input.projectId || null, createdById: ctx.user.id },
    });
  });
  await audit(ctx, { action: "expense.create", resource: "Expense", resourceId: e.id, summary: `${ctx.user.name} a saisi la dépense ${e.number} (${formatMoney(amount.toNumber(), e.currency)}) : ${e.description}.`, after: { number: e.number, amount: e.amount } });
  return e;
}

export async function updateExpense(ctx: Ctx, input: z.output<typeof updateExpenseSchema>) {
  const before = await getExpense(ctx, input.id);
  assertOwnerOrManager(ctx, before.createdById);
  if (before.status !== "DRAFT" && before.status !== "REJECTED") throw businessRule("Seule une dépense en brouillon ou refusée est modifiable.");
  await checkRefs(ctx, input);
  const amount = roundMoney(input.amount, before.currency);
  const after = await ctx.db.expense.update({
    where: { id: input.id },
    data: { date: parseDate(input.date) ?? before.date, categoryId: input.categoryId, supplierId: input.supplierId || null, description: input.description.trim(), amount: amount.toString(), method: input.method, accountId: input.accountId || null, reference: blank(input.reference), notes: blank(input.notes), branchId: input.branchId || null, costCenterId: input.costCenterId || null, projectId: input.projectId || null, status: "DRAFT" },
  });
  await audit(ctx, { action: "expense.update", resource: "Expense", resourceId: after.id, summary: `${ctx.user.name} a modifié la dépense ${after.number}.`, before: { amount: before.amount }, after: { amount: after.amount } });
  return after;
}

export async function deleteExpense(ctx: Ctx, id: string) {
  const e = await getExpense(ctx, id);
  assertOwnerOrManager(ctx, e.createdById);
  if (e.status !== "DRAFT") throw businessRule("Seule une dépense en brouillon peut être supprimée.");
  await ctx.db.expense.delete({ where: { id } });
  await audit(ctx, { action: "expense.delete", resource: "Expense", resourceId: id, summary: `${ctx.user.name} a supprimé la dépense ${e.number}.` });
}

/** Soumission : approbation si le montant atteint le seuil de la règle, sinon approuvée directement. */
export async function submitExpense(ctx: Ctx, id: string) {
  const e = await getExpense(ctx, id);
  assertOwnerOrManager(ctx, e.createdById);
  if (e.status !== "DRAFT") throw businessRule("Cette dépense a déjà été soumise.");
  const needs = await requiresApproval(ctx, "expense", e.amount);
  await ctx.tx(async (tx) => {
    if (needs) {
      await tx.expense.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await requestApproval(tx, ctx, { type: "expense", resourceId: id, title: `Dépense ${e.number} — ${e.description}`, amount: e.amount });
    } else {
      await tx.expense.update({ where: { id }, data: { status: "APPROVED" } });
    }
  });
  await audit(ctx, { action: "expense.submit", resource: "Expense", resourceId: id, summary: `${ctx.user.name} a soumis la dépense ${e.number}${needs ? " à validation" : " (approuvée automatiquement)"}.` });
  return { needsApproval: needs };
}

/**
 * Règlement d'une dépense approuvée : sortie de trésorerie sur le compte choisi (solde vérifié),
 * événement `expense.paid` pour la comptabilité. Tout dans une seule transaction.
 */
export async function payExpense(ctx: Ctx, input: z.output<typeof payExpenseSchema>) {
  const e = await getExpense(ctx, input.id);
  if (e.status !== "APPROVED") throw businessRule(e.status === "PAID" ? "Cette dépense est déjà payée." : "Seule une dépense approuvée peut être payée.");
  const account = await resolveAccount(ctx.db, { accountId: input.accountId });
  if (!account) throw notFound("Compte");
  const date = parseDate(input.date) ?? new Date();
  await ctx.tx(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${e.id}::uuid FOR UPDATE`; // deux paiements simultanés sont sérialisés
    const fresh = await tx.expense.findFirstOrThrow({ where: { id: e.id } });
    if (fresh.status !== "APPROVED") throw businessRule("Cette dépense est déjà payée.");
    await recordTransaction(tx, ctx, { accountId: account.id, type: "OUT", date, amount: fresh.amount, description: `${fresh.number} — ${fresh.description}`, reference: input.reference || fresh.reference, categoryId: fresh.categoryId, sourceType: "expense", sourceId: fresh.id });
    await tx.expense.update({ where: { id: e.id }, data: { status: "PAID", paidAt: date, paidById: ctx.user.id, accountId: account.id, method: input.method, ...(input.reference ? { reference: input.reference.trim() } : {}) } });
    await emit(tx, ctx, "expense.paid", { expenseId: e.id });
  });
  await audit(ctx, { action: "expense.pay", resource: "Expense", resourceId: e.id, summary: `${ctx.user.name} a payé la dépense ${e.number} (${formatMoney(d(e.amount).toNumber(), e.currency)}) depuis « ${account.name} ».` });
}

export async function cancelExpense(ctx: Ctx, id: string) {
  const e = await getExpense(ctx, id);
  assertOwnerOrManager(ctx, e.createdById);
  if (e.status === "CANCELLED") throw businessRule("Cette dépense est déjà annulée.");
  if (e.status === "PAID" && !ctx.can("finance.expense.approve") && !ctx.access.isAdmin) throw forbidden("Seul un valideur peut annuler une dépense payée.");
  await ctx.tx(async (tx) => {
    if (e.status === "PAID") {
      await cancelTransactionsOf(tx, "expense", id);
      await emit(tx, ctx, "expense.cancelled", { expenseId: id });
    }
    await cancelApprovals(tx, "expense", id);
    await tx.expense.update({ where: { id }, data: { status: "CANCELLED" } });
  });
  await audit(ctx, { action: "expense.cancel", resource: "Expense", resourceId: id, summary: `${ctx.user.name} a annulé la dépense ${e.number}${e.status === "PAID" ? " (la sortie de trésorerie est annulée)" : ""}.` });
}
