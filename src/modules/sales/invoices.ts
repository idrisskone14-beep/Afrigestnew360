import "server-only";
import { cancelApprovals, requestApproval, requiresApproval } from "@/core/approvals";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { emit } from "@/core/events";
import { businessRule, notFound } from "@/core/errors";
import { sendMail } from "@/core/mail";
import { computeLine, d, splitInstallments, type Decimal, type Numeric } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { assertOrgRefs } from "@/modules/org/service";
import { assertProject } from "@/modules/projects/refs";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import { lineData, parseDate, resolveLines } from "@/core/documents/lines";
import { getOrder, refreshOrderStatus } from "./orders";
import type { creditNoteSchema, invoiceSchema, issueInvoiceSchema, reminderSchema, updateInvoiceSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const DAY = 86_400_000;

// ── Calculs ───────────────────────────────────────────────────

export const invoiceBalance = (inv: { total: Numeric; amountPaid: Numeric; creditedAmount: Numeric }): Decimal => d(inv.total).minus(d(inv.amountPaid)).minus(d(inv.creditedAmount));

const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

export function isOverdue(inv: { status: string; dueDate: Date | null; total: Numeric; amountPaid: Numeric; creditedAmount: Numeric }, today = startOfToday()) {
  return (inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID") && inv.dueDate !== null && inv.dueDate < today && invoiceBalance(inv).gt(0);
}

/** Jours de retard d'une facture échue (0 si non échue). */
export const daysLate = (due: Date | null) => (due ? Math.max(0, Math.floor((startOfToday().getTime() - due.getTime()) / DAY) + 0) : 0);

export type InvoiceStatusT = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

/** Recalcule le statut d'une facture émise d'après ses encaissements et avoirs. */
export async function applyInvoiceSettlement(tx: Db, invoiceId: string) {
  const inv = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") return inv;
  const balance = invoiceBalance(inv);
  const status: InvoiceStatusT = balance.lte(0) ? "PAID" : d(inv.amountPaid).gt(0) ? "PARTIALLY_PAID" : "ISSUED";
  return status === inv.status ? inv : tx.invoice.update({ where: { id: invoiceId }, data: { status } });
}

/** Solde client : encours (factures émises non soldées), part échue et trop-perçu. */
export async function customerBalance(ctx: Pick<Ctx, "db">, customerId: string) {
  const invs = await ctx.db.invoice.findMany({ where: { customerId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, select: { status: true, dueDate: true, total: true, amountPaid: true, creditedAmount: true } });
  let outstanding = d(0);
  let overdue = d(0);
  let credit = d(0);
  for (const i of invs) {
    const b = invoiceBalance(i);
    if (b.gt(0)) { outstanding = outstanding.plus(b); if (isOverdue(i)) overdue = overdue.plus(b); } else if (b.lt(0)) credit = credit.plus(b.neg());
  }
  return { outstanding, overdue, credit };
}

// ── Lecture ───────────────────────────────────────────────────

export async function listInvoices(ctx: Ctx, p: { q?: string; status?: InvoiceStatusT | "OVERDUE"; customerId?: string; skip: number; take: number }) {
  const today = startOfToday();
  const where = {
    ...(p.status === "OVERDUE" ? { status: { in: ["ISSUED", "PARTIALLY_PAID"] as InvoiceStatusT[] }, dueDate: { lt: today } } : p.status ? { status: p.status } : {}),
    ...(p.customerId ? { customerId: p.customerId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { customer: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.invoice.count({ where }),
    ctx.db.invoice.findMany({ where, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { customer: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}

export async function getInvoice(ctx: Ctx, id: string) {
  const inv = await ctx.db.invoice.findFirst({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } }, customer: true, installments: { orderBy: { position: "asc" } },
      payments: { orderBy: { date: "desc" } }, creditNotes: { orderBy: { createdAt: "desc" } }, reminders: { orderBy: { sentAt: "desc" } },
    },
  });
  if (!inv) throw notFound("Facture");
  return inv;
}

async function assertCustomer(ctx: Ctx, customerId: string) {
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!c) throw notFound("Client");
  if (!c.isActive) throw businessRule("Ce client est inactif.");
  return c;
}

// ── Création / modification (brouillon) ───────────────────────

export async function createInvoice(ctx: Ctx, input: z.output<typeof invoiceSchema>) {
  const customer = await assertCustomer(ctx, input.customerId);
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  await assertProject(ctx.db, input.projectId);
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const issue = parseDate(input.issueDate) ?? new Date();
  const inv = await ctx.db.invoice.create({
    data: {
      companyId: ctx.company.id, customerId: customer.id, status: "DRAFT", issueDate: issue, dueDate: parseDate(input.dueDate) ?? new Date(issue.getTime() + customer.paymentTermsDays * DAY),
      currency: ctx.company.currency, ...totals, notes: blank(input.notes), terms: blank(input.terms), costCenterId: input.costCenterId || null, branchId: input.branchId || null, projectId: input.projectId || null, createdById: ctx.user.id,
      lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) },
    },
  });
  await audit(ctx, { action: "invoice.create", resource: "Invoice", resourceId: inv.id, summary: `${ctx.user.name} a créé une facture brouillon pour ${customer.name}.`, after: { total: totals.total } });
  return inv;
}

export async function updateInvoice(ctx: Ctx, input: z.output<typeof updateInvoiceSchema>) {
  const before = await getInvoice(ctx, input.id);
  if (before.status !== "DRAFT") throw businessRule("Une facture émise n'est plus modifiable : annulez-la ou émettez un avoir.");
  const customer = await assertCustomer(ctx, input.customerId);
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  await assertProject(ctx.db, input.projectId);
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const issue = parseDate(input.issueDate) ?? before.issueDate;
  const after = await ctx.tx(async (tx) => {
    await tx.invoiceLine.deleteMany({ where: { invoiceId: input.id } });
    return tx.invoice.update({
      where: { id: input.id },
      data: {
        customerId: customer.id, issueDate: issue, dueDate: parseDate(input.dueDate) ?? new Date(issue.getTime() + customer.paymentTermsDays * DAY), ...totals, notes: blank(input.notes), terms: blank(input.terms),
        costCenterId: input.costCenterId || null, branchId: input.branchId || null, projectId: input.projectId || null, lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) },
      },
    });
  });
  await audit(ctx, { action: "invoice.update", resource: "Invoice", resourceId: after.id, summary: `${ctx.user.name} a modifié la facture brouillon.`, before: { total: before.total }, after: { total: totals.total } });
  return after;
}

export async function deleteInvoice(ctx: Ctx, id: string) {
  const inv = await getInvoice(ctx, id);
  if (inv.status !== "DRAFT") throw businessRule("Seule une facture en brouillon peut être supprimée.");
  await ctx.tx(async (tx) => {
    if (inv.quoteId) await tx.quote.updateMany({ where: { id: inv.quoteId, convertedInvoiceId: id }, data: { status: "ACCEPTED", convertedInvoiceId: null } });
    await cancelApprovals(tx, "discount", id);
    await tx.invoice.delete({ where: { id } });
  });
  await audit(ctx, { action: "invoice.delete", resource: "Invoice", resourceId: id, summary: `${ctx.user.name} a supprimé une facture brouillon.` });
}

/** Commande → facture brouillon : quantités restant à facturer, sans ressaisie. */
export async function createInvoiceFromOrder(ctx: Ctx, orderId: string, opts: { onlyDelivered?: boolean } = {}) {
  const order = await getOrder(ctx, orderId);
  if (order.status === "DRAFT" || order.status === "CANCELLED") throw businessRule("Confirmez la commande avant de la facturer.");
  const toInvoice = order.lines
    .map((l) => ({ l, qty: (opts.onlyDelivered ? d(l.deliveredQty) : d(l.quantity)).minus(l.invoicedQty) }))
    .filter((x) => x.qty.gt(0));
  if (toInvoice.length === 0) throw businessRule("Tout a déjà été facturé pour cette commande.");
  const issue = new Date();
  const lines = toInvoice.map(({ l, qty }, i) => {
    const a = computeLine({ quantity: qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate }, order.currency);
    return { companyId: ctx.company.id, position: i, orderLineId: l.id, productId: l.productId, description: l.description, unit: l.unit, quantity: qty.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), taxId: l.taxId, taxRate: l.taxRate.toString(), netAmount: a.net.toString(), taxAmount: a.tax.toString(), total: a.total.toString(), gross: a.gross, discount: a.discount };
  });
  const sum = (f: (x: (typeof lines)[number]) => Numeric) => lines.reduce((a, x) => a.plus(d(f(x))), d(0)).toString();
  const inv = await ctx.db.invoice.create({
    data: {
      companyId: ctx.company.id, customerId: order.customerId, orderId: order.id, quoteId: order.quoteId, status: "DRAFT", issueDate: issue, dueDate: new Date(issue.getTime() + order.customer.paymentTermsDays * DAY), currency: order.currency,
      subtotal: sum((x) => x.gross), discountTotal: sum((x) => x.discount), taxTotal: sum((x) => x.taxAmount), total: sum((x) => x.total), notes: order.notes, createdById: ctx.user.id,
      lines: { create: lines.map(({ gross: _g, discount: _d, ...rest }) => rest) },
    },
  });
  await audit(ctx, { action: "invoice.create", resource: "Invoice", resourceId: inv.id, summary: `${ctx.user.name} a créé une facture brouillon depuis la commande ${order.number}.`, after: { orderId } });
  return inv;
}

// ── Émission / annulation ─────────────────────────────────────

/**
 * Remise commerciale : si les règles de validation de l'entreprise (type « Remises commerciales ») l'exigent pour ce montant de remise,
 * la facture ne peut être émise qu'après approbation. Une demande approuvée vaut pour CE montant de remise : si la remise change,
 * une nouvelle validation est nécessaire. La demande est créée (et conservée) avant de refuser l'émission.
 */
async function ensureDiscountApproved(ctx: Ctx, inv: { id: string; discountTotal: Numeric; currency: string }, customerName: string) {
  const discount = d(inv.discountTotal);
  if (discount.lte(0) || !(await requiresApproval(ctx, "discount", discount))) return;
  const last = await ctx.db.approvalRequest.findFirst({ where: { resourceType: "discount", resourceId: inv.id }, orderBy: { createdAt: "desc" } });
  const same = last !== null && d(last.amount).eq(discount);
  const money = formatMoney(discount.toNumber(), inv.currency);
  if (last?.status === "APPROVED" && same) return;
  if (last?.status === "PENDING" && same) throw businessRule(`La remise de ${money} est en attente de validation (menu « Validations »).`);
  if (last?.status === "REJECTED" && same) throw businessRule(`La remise de ${money} a été refusée : modifiez-la avant d'émettre la facture.`);
  await ctx.tx((tx) => requestApproval(tx, ctx, { type: "discount", resourceId: inv.id, title: `Remise de ${money} — facture de ${customerName}`, amount: discount, detail: `${ctx.user.name} demande la validation d'une remise de ${money} (client ${customerName}).` }));
  throw businessRule(`Une remise de ${money} doit être validée avant l'émission de la facture. La demande vient d'être envoyée aux validateurs.`);
}

export async function issueInvoice(ctx: Ctx, input: z.output<typeof issueInvoiceSchema>) {
  const inv = await getInvoice(ctx, input.id);
  if (inv.status !== "DRAFT") throw businessRule("Cette facture est déjà émise.");
  if (inv.lines.length === 0 || d(inv.total).lte(0)) throw businessRule("Une facture doit avoir un montant positif.");
  const customer = await assertCustomer(ctx, inv.customerId);
  await ensureDiscountApproved(ctx, inv, customer.name);

  if (customer.creditLimit) {
    const { outstanding } = await customerBalance(ctx, customer.id);
    if (outstanding.plus(inv.total).gt(customer.creditLimit)) {
      if (!(input.allowOverLimit && ctx.can("sales.discount.approve"))) {
        throw businessRule(`Plafond de crédit dépassé pour ${customer.name} : encours ${formatMoney(outstanding.toNumber(), inv.currency)} + cette facture > plafond ${formatMoney(d(customer.creditLimit).toNumber(), inv.currency)}.`);
      }
    }
  }

  const issued = await ctx.tx(async (tx) => {
    const issueDate = inv.issueDate;
    const number = await nextNumber(tx, ctx.company.id, "invoice", issueDate);
    const due = inv.dueDate ?? new Date(issueDate.getTime() + customer.paymentTermsDays * DAY);
    const parts = splitInstallments(inv.total, input.installments, inv.currency);
    await tx.invoiceInstallment.createMany({ data: parts.map((amount, i) => ({ companyId: ctx.company.id, invoiceId: inv.id, position: i, dueDate: new Date(due.getTime() + i * 30 * DAY), amount: amount.toString() })) });

    // rattachement à la commande : quantités facturées
    const orderIds = new Set<string>();
    for (const l of inv.lines) {
      if (!l.orderLineId) continue;
      const ol = await tx.orderLine.findFirst({ where: { id: l.orderLineId } });
      if (!ol) continue;
      const next = d(ol.invoicedQty).plus(l.quantity);
      if (next.gt(ol.quantity)) throw businessRule(`« ${ol.description} » : la quantité facturée dépasserait la commande.`);
      await tx.orderLine.update({ where: { id: ol.id }, data: { invoicedQty: next.toString() } });
      orderIds.add(ol.orderId);
    }
    for (const oid of orderIds) await refreshOrderStatus(tx, oid);

    const res = await tx.invoice.update({ where: { id: inv.id }, data: { number, status: "ISSUED", issuedAt: new Date(), dueDate: due } });
    await emit(tx, ctx, "invoice.issued", { invoiceId: inv.id });
    return res;
  });
  await audit(ctx, { action: "invoice.issue", resource: "Invoice", resourceId: inv.id, summary: `${ctx.user.name} a émis la facture ${issued.number} (${customer.name}, ${formatMoney(d(inv.total).toNumber(), inv.currency)}).`, after: { number: issued.number, total: inv.total } });
  return issued;
}

export async function cancelInvoice(ctx: Ctx, id: string) {
  const inv = await getInvoice(ctx, id);
  if (inv.status === "CANCELLED") throw businessRule("Cette facture est déjà annulée.");
  if (inv.status === "DRAFT") throw businessRule("Supprimez le brouillon plutôt que de l'annuler.");
  if (d(inv.amountPaid).gt(0) || d(inv.creditedAmount).gt(0) || inv.payments.some((p) => p.status !== "CANCELLED")) {
    throw businessRule("Des paiements ou avoirs existent : annulez les paiements, ou émettez un avoir.");
  }
  await ctx.tx(async (tx) => {
    const orderIds = new Set<string>();
    for (const l of inv.lines) {
      if (!l.orderLineId) continue;
      const ol = await tx.orderLine.findFirst({ where: { id: l.orderLineId } });
      if (!ol) continue;
      await tx.orderLine.update({ where: { id: ol.id }, data: { invoicedQty: d(ol.invoicedQty).minus(l.quantity).toString() } });
      orderIds.add(ol.orderId);
    }
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    for (const oid of orderIds) await refreshOrderStatus(tx, oid);
    await emit(tx, ctx, "invoice.cancelled", { invoiceId: id });
  });
  await audit(ctx, { action: "invoice.cancel", resource: "Invoice", resourceId: id, summary: `${ctx.user.name} a annulé la facture ${inv.number}.`, before: { status: inv.status } });
}

// ── Avoirs ────────────────────────────────────────────────────

export async function listCreditNotes(ctx: Ctx, p: { invoiceId?: string; skip: number; take: number }) {
  const where = p.invoiceId ? { invoiceId: p.invoiceId } : {};
  const [total, rows] = await Promise.all([
    ctx.db.creditNote.count({ where }),
    ctx.db.creditNote.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { invoice: { select: { id: true, number: true, customer: { select: { name: true } } } } } }),
  ]);
  return { total, rows };
}

export async function getCreditNote(ctx: Ctx, id: string) {
  const cn = await ctx.db.creditNote.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, invoice: { include: { customer: true } } } });
  if (!cn) throw notFound("Avoir");
  return cn;
}

export async function createCreditNote(ctx: Ctx, input: z.output<typeof creditNoteSchema>) {
  const inv = await getInvoice(ctx, input.invoiceId);
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") throw businessRule("Un avoir se rattache à une facture émise.");
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) throw businessRule("Indiquez au moins une quantité à créditer.");

  const prior = await ctx.db.creditNoteLine.findMany({ where: { creditNote: { invoiceId: inv.id, status: { not: "CANCELLED" } } }, select: { invoiceLineId: true, quantity: true } });
  const credited = new Map<string, Decimal>();
  for (const p of prior) if (p.invoiceLineId) credited.set(p.invoiceLineId, (credited.get(p.invoiceLineId) ?? d(0)).plus(p.quantity));

  const byId = new Map(inv.lines.map((l) => [l.id, l]));
  let gross = d(0), tax = d(0), total = d(0);
  const rows = wanted.map((w, i) => {
    const l = byId.get(w.invoiceLineId);
    if (!l) throw notFound("Ligne de facture");
    const left = d(l.quantity).minus(credited.get(l.id) ?? 0);
    if (d(w.quantity).gt(left)) throw businessRule(`« ${l.description} » : ${left.toString()} restant(s) à créditer.`);
    const a = computeLine({ quantity: w.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate }, inv.currency);
    gross = gross.plus(a.net); tax = tax.plus(a.tax); total = total.plus(a.total);
    return { companyId: ctx.company.id, position: i, invoiceLineId: l.id, productId: l.productId, description: l.description, unit: l.unit, quantity: d(w.quantity).toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), taxRate: l.taxRate.toString(), netAmount: a.net.toString(), taxAmount: a.tax.toString(), total: a.total.toString() };
  });
  if (total.gt(d(inv.total).minus(inv.creditedAmount))) throw businessRule("Le montant de l'avoir dépasse ce qui reste à créditer sur la facture.");

  const cn = await ctx.db.creditNote.create({
    data: { companyId: ctx.company.id, invoiceId: inv.id, customerId: inv.customerId, status: "DRAFT", reason: input.reason.trim(), restock: input.restock, currency: inv.currency, subtotal: gross.toString(), taxTotal: tax.toString(), total: total.toString(), createdById: ctx.user.id, lines: { create: rows } },
  });
  await audit(ctx, { action: "credit_note.create", resource: "CreditNote", resourceId: cn.id, summary: `${ctx.user.name} a créé un avoir brouillon sur la facture ${inv.number}.`, after: { total: total.toString() } });
  return cn;
}

export async function issueCreditNote(ctx: Ctx, id: string) {
  const cn = await getCreditNote(ctx, id);
  if (cn.status !== "DRAFT") throw businessRule("Cet avoir est déjà émis.");
  const issued = await ctx.tx(async (tx) => {
    const inv = await tx.invoice.findFirstOrThrow({ where: { id: cn.invoiceId } });
    if (inv.status === "CANCELLED" || inv.status === "DRAFT") throw businessRule("La facture n'est plus créditable.");
    if (d(cn.total).gt(d(inv.total).minus(inv.creditedAmount))) throw businessRule("Le montant de l'avoir dépasse ce qui reste à créditer.");
    const number = await nextNumber(tx, ctx.company.id, "credit_note");
    const res = await tx.creditNote.update({ where: { id }, data: { number, status: "ISSUED", issueDate: new Date() } });
    await tx.invoice.update({ where: { id: inv.id }, data: { creditedAmount: d(inv.creditedAmount).plus(cn.total).toString() } });
    // l'avoir réduit les échéances restantes, de la dernière à la première
    let left = d(cn.total);
    const insts = await tx.invoiceInstallment.findMany({ where: { invoiceId: inv.id }, orderBy: { position: "desc" } });
    for (const it of insts) {
      if (left.lte(0)) break;
      const reducible = d(it.amount).minus(it.paidAmount);
      const cut = Decimal_min(reducible, left);
      if (cut.gt(0)) { await tx.invoiceInstallment.update({ where: { id: it.id }, data: { amount: d(it.amount).minus(cut).toString() } }); left = left.minus(cut); }
    }
    await applyInvoiceSettlement(tx, inv.id);
    await emit(tx, ctx, "credit_note.issued", { creditNoteId: id });
    return res;
  });
  await audit(ctx, { action: "credit_note.issue", resource: "CreditNote", resourceId: id, summary: `${ctx.user.name} a émis l'avoir ${issued.number} (facture ${cn.invoice.number}).`, after: { total: cn.total } });
  return issued;
}

const Decimal_min = (a: Decimal, b: Decimal) => (a.lt(b) ? a : b);

export async function deleteCreditNote(ctx: Ctx, id: string) {
  const cn = await getCreditNote(ctx, id);
  if (cn.status !== "DRAFT") throw businessRule("Seul un avoir en brouillon peut être supprimé.");
  await ctx.db.creditNote.delete({ where: { id } });
  await audit(ctx, { action: "credit_note.delete", resource: "CreditNote", resourceId: id, summary: `${ctx.user.name} a supprimé un avoir brouillon.` });
}

// ── Relances ──────────────────────────────────────────────────

export async function overdueInvoices(ctx: Ctx, take = 100) {
  const rows = await ctx.db.invoice.findMany({
    where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: startOfToday() } }, orderBy: { dueDate: "asc" }, take,
    include: { customer: { select: { id: true, name: true, email: true } }, reminders: { orderBy: { sentAt: "desc" }, take: 1 }, _count: { select: { reminders: true } } },
  });
  return rows.filter((i) => invoiceBalance(i).gt(0));
}

export async function remindInvoice(ctx: Ctx, input: z.output<typeof reminderSchema>) {
  const inv = await getInvoice(ctx, input.invoiceId);
  if (!isOverdue(inv)) throw businessRule("Cette facture n'est pas échue.");
  const level = inv.reminders.length + 1;
  if (input.channel === "EMAIL") {
    if (!inv.customer.email) throw businessRule("Ce client n'a pas d'adresse e-mail.");
    const balance = formatMoney(invoiceBalance(inv).toNumber(), inv.currency);
    const company = ctx.company.tradeName ?? ctx.company.legalName;
    await sendMail({
      to: inv.customer.email,
      subject: `${level > 1 ? "Relance " + level + " — " : "Rappel — "}Facture ${inv.number} échue`,
      text: `Bonjour,\n\nSauf erreur de notre part, la facture ${inv.number} d'un montant restant de ${balance}, échue le ${inv.dueDate!.toLocaleDateString("fr-FR")}, n'a pas été réglée.\n\nMerci de procéder à son règlement dans les meilleurs délais. Si ce paiement a été effectué, veuillez ne pas tenir compte de ce message.\n\nCordialement,\n${company}`,
    });
  }
  const r = await ctx.db.reminder.create({ data: { companyId: ctx.company.id, invoiceId: inv.id, level, channel: input.channel, note: blank(input.note), createdById: ctx.user.id } });
  await audit(ctx, { action: "invoice.remind", resource: "Invoice", resourceId: inv.id, summary: `${ctx.user.name} a relancé ${inv.customer.name} (facture ${inv.number}, relance n°${level}, ${input.channel}).` });
  return r;
}

