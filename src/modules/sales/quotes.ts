import "server-only";
import { audit } from "@/core/audit";
import { emit } from "@/core/events";
import { businessRule, notFound } from "@/core/errors";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import type { z } from "zod";
import { lineData, parseDate, resolveLines } from "@/core/documents/lines";
import type { quoteSchema, updateQuoteSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

type QuoteStatusT = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CONVERTED";

/** Statut affiché : un devis envoyé/brouillon dont la validité est dépassée apparaît « expiré ». */
export function effectiveQuoteStatus(q: { status: QuoteStatusT; validUntil: Date | null }): QuoteStatusT {
  if ((q.status === "SENT" || q.status === "DRAFT") && q.validUntil && q.validUntil.getTime() < Date.now() - 86_400_000) return "EXPIRED";
  return q.status;
}

async function assertCustomer(ctx: Ctx, customerId: string) {
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!c) throw notFound("Client");
  if (!c.isActive) throw businessRule("Ce client est inactif.");
  return c;
}

export async function listQuotes(ctx: Ctx, p: { q?: string; status?: QuoteStatusT; customerId?: string; skip: number; take: number }) {
  const where = {
    ...(p.status && p.status !== "EXPIRED" ? { status: p.status } : {}),
    ...(p.status === "EXPIRED" ? { status: { in: ["DRAFT", "SENT"] as QuoteStatusT[] }, validUntil: { lt: new Date(Date.now() - 86_400_000) } } : {}),
    ...(p.customerId ? { customerId: p.customerId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { customer: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.quote.count({ where }),
    ctx.db.quote.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { customer: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}

export async function getQuote(ctx: Ctx, id: string) {
  const q = await ctx.db.quote.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, customer: true } });
  if (!q) throw notFound("Devis");
  return q;
}

export async function createQuote(ctx: Ctx, input: z.output<typeof quoteSchema>) {
  const customer = await assertCustomer(ctx, input.customerId);
  if (input.opportunityId && !(await ctx.db.opportunity.findFirst({ where: { id: input.opportunityId }, select: { id: true } }))) throw notFound("Opportunité");
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const issue = parseDate(input.issueDate) ?? new Date();
  const validUntil = parseDate(input.validUntil) ?? new Date(issue.getTime() + 30 * 86_400_000);

  const quote = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, input.kind === "PROFORMA" ? "proforma" : "quote", issue);
    return tx.quote.create({
      data: {
        companyId: ctx.company.id, number, kind: input.kind, customerId: customer.id, opportunityId: input.opportunityId || null, issueDate: issue, validUntil,
        currency: ctx.company.currency, ...totals, notes: blank(input.notes), terms: blank(input.terms), createdById: ctx.user.id,
        lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) },
      },
    });
  });
  await audit(ctx, { action: "quote.create", resource: "Quote", resourceId: quote.id, summary: `${ctx.user.name} a créé le ${input.kind === "PROFORMA" ? "proforma" : "devis"} ${quote.number} pour ${customer.name}.`, after: { number: quote.number, total: totals.total } });
  return quote;
}

export async function updateQuote(ctx: Ctx, input: z.output<typeof updateQuoteSchema>) {
  const before = await getQuote(ctx, input.id);
  if (!["DRAFT", "SENT"].includes(before.status)) throw businessRule("Seuls les devis en brouillon ou envoyés sont modifiables.");
  const customer = await assertCustomer(ctx, input.customerId);
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const after = await ctx.tx(async (tx) => {
    await tx.quoteLine.deleteMany({ where: { quoteId: input.id } });
    return tx.quote.update({
      where: { id: input.id },
      data: {
        customerId: customer.id, issueDate: parseDate(input.issueDate) ?? before.issueDate, validUntil: parseDate(input.validUntil), ...totals,
        notes: blank(input.notes), terms: blank(input.terms), status: "DRAFT",
        lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) },
      },
    });
  });
  await audit(ctx, { action: "quote.update", resource: "Quote", resourceId: after.id, summary: `${ctx.user.name} a modifié le devis ${after.number}.`, before: { total: before.total, status: before.status }, after: { total: totals.total } });
  return after;
}

export async function setQuoteStatus(ctx: Ctx, input: { id: string; status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" }) {
  const q = await getQuote(ctx, input.id);
  const eff = effectiveQuoteStatus(q);
  if (q.status === "CONVERTED") throw businessRule("Ce devis a déjà été converti.");
  if (input.status === "ACCEPTED" && eff === "EXPIRED") throw businessRule("Ce devis est expiré : prolongez sa validité (modifiez-le) avant de l'accepter.");
  const allowed: Record<string, string[]> = { DRAFT: ["SENT", "ACCEPTED", "REJECTED"], SENT: ["DRAFT", "ACCEPTED", "REJECTED"], ACCEPTED: ["REJECTED"], REJECTED: ["DRAFT"], EXPIRED: ["DRAFT"] };
  if (!allowed[q.status]?.includes(input.status)) throw businessRule("Changement de statut impossible.");
  const after = await ctx.db.quote.update({ where: { id: q.id }, data: { status: input.status } });
  await audit(ctx, { action: "quote.status", resource: "Quote", resourceId: q.id, summary: `${ctx.user.name} a passé le devis ${q.number} au statut « ${input.status} ».`, before: { status: q.status }, after: { status: input.status } });
  return after;
}

export async function deleteQuote(ctx: Ctx, id: string) {
  const q = await getQuote(ctx, id);
  if (q.status !== "DRAFT") throw businessRule("Seul un devis en brouillon peut être supprimé.");
  await ctx.db.quote.delete({ where: { id } });
  await audit(ctx, { action: "quote.delete", resource: "Quote", resourceId: id, summary: `${ctx.user.name} a supprimé le devis ${q.number}.`, before: { number: q.number } });
}

/** Devis → commande (confirmée) : lignes copiées, stock réservé si le module Stock est actif. */
export async function convertQuoteToOrder(ctx: Ctx, id: string) {
  const q = await getQuote(ctx, id);
  if (q.status === "CONVERTED") throw businessRule("Ce devis a déjà été converti.");
  if (q.kind === "PROFORMA") throw businessRule("Un proforma ne se convertit pas en commande : facturez-le ou recréez un devis.");
  if (q.status === "REJECTED") throw businessRule("Ce devis a été refusé.");
  if (effectiveQuoteStatus(q) === "EXPIRED") throw businessRule("Ce devis est expiré.");

  const order = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "order");
    const o = await tx.salesOrder.create({
      data: {
        companyId: ctx.company.id, number, customerId: q.customerId, quoteId: q.id, status: "CONFIRMED", currency: q.currency, subtotal: q.subtotal.toString(), discountTotal: q.discountTotal.toString(),
        taxTotal: q.taxTotal.toString(), total: q.total.toString(), notes: q.notes, createdById: ctx.user.id,
        lines: { create: q.lines.map((l) => ({ companyId: ctx.company.id, position: l.position, productId: l.productId, description: l.description, unit: l.unit, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), taxId: l.taxId, taxRate: l.taxRate.toString(), netAmount: l.netAmount.toString(), taxAmount: l.taxAmount.toString(), total: l.total.toString() })) },
      },
    });
    await tx.quote.update({ where: { id: q.id }, data: { status: "CONVERTED", convertedOrderId: o.id } });
    await emit(tx, ctx, "order.confirmed", { orderId: o.id });
    return o;
  });
  await audit(ctx, { action: "quote.convert_order", resource: "Quote", resourceId: q.id, summary: `${ctx.user.name} a converti le devis ${q.number} en commande ${order.number}.`, after: { orderId: order.id } });
  return order;
}

/** Devis (ou proforma) → facture brouillon, sans ressaisie. */
export async function convertQuoteToInvoice(ctx: Ctx, id: string) {
  const q = await getQuote(ctx, id);
  if (q.status === "CONVERTED") throw businessRule("Ce devis a déjà été converti.");
  if (q.status === "REJECTED") throw businessRule("Ce devis a été refusé.");
  const terms = q.customer.paymentTermsDays;
  const issue = new Date();
  const invoice = await ctx.tx(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        companyId: ctx.company.id, customerId: q.customerId, quoteId: q.id, status: "DRAFT", issueDate: issue, dueDate: new Date(issue.getTime() + terms * 86_400_000), currency: q.currency,
        subtotal: q.subtotal.toString(), discountTotal: q.discountTotal.toString(), taxTotal: q.taxTotal.toString(), total: q.total.toString(), notes: q.notes, terms: q.terms, createdById: ctx.user.id,
        lines: { create: q.lines.map((l) => ({ companyId: ctx.company.id, position: l.position, productId: l.productId, description: l.description, unit: l.unit, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), taxId: l.taxId, taxRate: l.taxRate.toString(), netAmount: l.netAmount.toString(), taxAmount: l.taxAmount.toString(), total: l.total.toString() })) },
      },
    });
    await tx.quote.update({ where: { id: q.id }, data: { status: "CONVERTED", convertedInvoiceId: inv.id } });
    return inv;
  });
  await audit(ctx, { action: "quote.convert_invoice", resource: "Quote", resourceId: q.id, summary: `${ctx.user.name} a converti le devis ${q.number} en facture (brouillon).`, after: { invoiceId: invoice.id } });
  return invoice;
}
