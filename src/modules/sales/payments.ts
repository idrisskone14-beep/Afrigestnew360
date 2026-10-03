import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { emit } from "@/core/events";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { d, roundMoney } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import { applyInvoiceSettlement, invoiceBalance } from "./invoices";
import { parseDate } from "@/core/documents/lines";
import type { paymentSchema } from "./schemas";

type Ctx = TenantContext;
type PaymentStatusT = "PENDING" | "VALIDATED" | "CANCELLED";
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/** Verrou de ligne : deux encaissements simultanés sur la même facture sont sérialisés. */
async function lockInvoice(tx: Db, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

export async function listPayments(ctx: Ctx, p: { q?: string; status?: PaymentStatusT; customerId?: string; invoiceId?: string; skip: number; take: number }) {
  const where = {
    direction: "IN" as const,
    ...(p.status ? { status: p.status } : {}),
    ...(p.customerId ? { customerId: p.customerId } : {}),
    ...(p.invoiceId ? { invoiceId: p.invoiceId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { reference: { contains: p.q, mode: "insensitive" as const } }, { customer: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.payment.count({ where }),
    ctx.db.payment.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { customer: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true } } } }),
  ]);
  return { total, rows };
}

export async function getPayment(ctx: Ctx, id: string) {
  const pay = await ctx.db.payment.findFirst({ where: { id, direction: "IN" }, include: { customer: true, invoice: true } });
  if (!pay) throw notFound("Paiement");
  return pay;
}

async function settle(tx: Db, ctx: Ctx, paymentId: string) {
  const pay = await tx.payment.findFirstOrThrow({ where: { id: paymentId } });
  await lockInvoice(tx, pay.invoiceId!);
  const inv = await tx.invoice.findFirstOrThrow({ where: { id: pay.invoiceId! } });
  if (inv.status !== "ISSUED" && inv.status !== "PARTIALLY_PAID") throw businessRule("La facture n'accepte plus de paiement.");
  if (d(pay.amount).gt(invoiceBalance(inv))) throw businessRule(`Le montant dépasse le reste à payer (${formatMoney(invoiceBalance(inv).toNumber(), inv.currency)}).`);

  await tx.invoice.update({ where: { id: inv.id }, data: { amountPaid: d(inv.amountPaid).plus(pay.amount).toString() } });
  // imputation sur l'échéancier, dans l'ordre
  let left = d(pay.amount);
  const insts = await tx.invoiceInstallment.findMany({ where: { invoiceId: inv.id }, orderBy: { position: "asc" } });
  for (const it of insts) {
    if (left.lte(0)) break;
    const room = d(it.amount).minus(it.paidAmount);
    if (room.lte(0)) continue;
    const take = left.lt(room) ? left : room;
    await tx.invoiceInstallment.update({ where: { id: it.id }, data: { paidAmount: d(it.paidAmount).plus(take).toString() } });
    left = left.minus(take);
  }
  await tx.payment.update({ where: { id: paymentId }, data: { status: "VALIDATED", validatedAt: new Date(), validatedById: ctx.user.id } });
  await applyInvoiceSettlement(tx, inv.id);
  await emit(tx, ctx, "payment.validated", { paymentId });
}

async function reverse(tx: Db, ctx: Ctx, paymentId: string) {
  const pay = await tx.payment.findFirstOrThrow({ where: { id: paymentId } });
  await lockInvoice(tx, pay.invoiceId!);
  const inv = await tx.invoice.findFirstOrThrow({ where: { id: pay.invoiceId! } });
  await tx.invoice.update({ where: { id: inv.id }, data: { amountPaid: d(inv.amountPaid).minus(pay.amount).toString() } });
  let left = d(pay.amount);
  const insts = await tx.invoiceInstallment.findMany({ where: { invoiceId: inv.id }, orderBy: { position: "desc" } });
  for (const it of insts) {
    if (left.lte(0)) break;
    const back = d(it.paidAmount).lt(left) ? d(it.paidAmount) : left;
    if (back.gt(0)) { await tx.invoiceInstallment.update({ where: { id: it.id }, data: { paidAmount: d(it.paidAmount).minus(back).toString() } }); left = left.minus(back); }
  }
  await emit(tx, ctx, "payment.cancelled", { paymentId });
  await tx.payment.update({ where: { id: paymentId }, data: { status: "CANCELLED" } });
  await applyInvoiceSettlement(tx, inv.id);
}

/**
 * Enregistre un encaissement. Validé immédiatement si l'utilisateur détient `finance.payment.validate`,
 * sinon en attente de validation (il ne compte alors pas dans le solde de la facture).
 */
export async function recordPayment(ctx: Ctx, input: z.output<typeof paymentSchema>) {
  const inv = await ctx.db.invoice.findFirst({ where: { id: input.invoiceId } });
  if (!inv) throw notFound("Facture");
  if (inv.status !== "ISSUED" && inv.status !== "PARTIALLY_PAID") throw businessRule("Seule une facture émise et non soldée accepte un paiement.");
  const amount = roundMoney(input.amount, inv.currency);
  if (amount.lte(0)) throw businessRule("Le montant doit être positif.");
  if (amount.gt(invoiceBalance(inv))) throw businessRule(`Le montant dépasse le reste à payer (${formatMoney(invoiceBalance(inv).toNumber(), inv.currency)}).`);
  const validateNow = ctx.can("finance.payment.validate");
  if (input.accountId && !(await ctx.db.financeAccount.findFirst({ where: { id: input.accountId, deletedAt: null, isActive: true }, select: { id: true } }))) throw notFound("Compte");

  const payment = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "receipt", parseDate(input.date) ?? new Date());
    const p = await tx.payment.create({
      data: { companyId: ctx.company.id, number, direction: "IN", customerId: inv.customerId, invoiceId: inv.id, amount: amount.toString(), currency: inv.currency, method: input.method, date: parseDate(input.date) ?? new Date(), reference: blank(input.reference), accountId: input.accountId || null, notes: blank(input.notes), status: "PENDING", createdById: ctx.user.id },
    });
    if (validateNow) await settle(tx, ctx, p.id);
    return p;
  });
  await audit(ctx, { action: "payment.create", resource: "Payment", resourceId: payment.id, summary: `${ctx.user.name} a enregistré un paiement de ${formatMoney(amount.toNumber(), inv.currency)} sur la facture ${inv.number} (${validateNow ? "validé" : "en attente de validation"}).`, after: { number: payment.number, amount: amount.toString() } });
  return { ...payment, status: validateNow ? ("VALIDATED" as const) : ("PENDING" as const) };
}

export async function validatePayment(ctx: Ctx, id: string) {
  if (!ctx.can("finance.payment.validate")) throw forbidden();
  const pay = await getPayment(ctx, id);
  if (pay.status !== "PENDING") throw businessRule("Ce paiement n'est pas en attente.");
  await ctx.tx((tx) => settle(tx, ctx, id));
  await audit(ctx, { action: "payment.validate", resource: "Payment", resourceId: id, summary: `${ctx.user.name} a validé le paiement ${pay.number} (${formatMoney(d(pay.amount).toNumber(), pay.currency)}).` });
}

export async function cancelPayment(ctx: Ctx, id: string) {
  const pay = await getPayment(ctx, id);
  if (pay.status === "CANCELLED") throw businessRule("Ce paiement est déjà annulé.");
  if (pay.status === "VALIDATED" && !ctx.can("finance.payment.validate")) throw forbidden("Seul un valideur peut annuler un paiement validé.");
  await ctx.tx(async (tx) => {
    if (pay.status === "VALIDATED") await reverse(tx, ctx, id);
    else await tx.payment.update({ where: { id }, data: { status: "CANCELLED" } });
  });
  await audit(ctx, { action: "payment.cancel", resource: "Payment", resourceId: id, summary: `${ctx.user.name} a annulé le paiement ${pay.number}.`, before: { status: pay.status } });
}
