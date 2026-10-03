import "server-only";
import { cancelApprovals, requestApproval, requiresApproval } from "@/core/approvals";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { lineData, parseDate, resolveLines } from "@/core/documents/lines";
import { businessRule, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { computeLine, d, roundMoney, type Decimal } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { assertOrgRefs } from "@/modules/org/service";
import { assertProject } from "@/modules/projects/refs";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import { getOrder, refreshPurchaseOrderStatus } from "./procurement";
import type { supplierBillSchema, supplierPaymentSchema, updateSupplierBillSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const DAY = 86_400_000;

export const billBalance = (b: { total: unknown; amountPaid: unknown }): Decimal => d(b.total as number).minus(d(b.amountPaid as number));
const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
export const isBillOverdue = (b: { status: string; dueDate: Date | null; total: unknown; amountPaid: unknown }) =>
  (b.status === "POSTED" || b.status === "PARTIALLY_PAID") && b.dueDate !== null && b.dueDate < startOfToday() && billBalance(b).gt(0);

async function assertSupplier(ctx: Ctx, id: string) {
  const s = await ctx.db.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!s) throw notFound("Fournisseur");
  if (!s.isActive) throw businessRule("Ce fournisseur est inactif.");
  return s;
}

export async function listBills(ctx: Ctx, p: { q?: string; status?: string; supplierId?: string; overdue?: boolean; skip: number; take: number }) {
  const where = {
    ...(p.overdue ? { status: { in: ["POSTED", "PARTIALLY_PAID"] as ("POSTED" | "PARTIALLY_PAID")[] }, dueDate: { lt: startOfToday() } } : p.status ? { status: p.status as never } : {}),
    ...(p.supplierId ? { supplierId: p.supplierId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { supplierRef: { contains: p.q, mode: "insensitive" as const } }, { supplier: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.supplierBill.count({ where }),
    ctx.db.supplierBill.findMany({ where, orderBy: [{ billDate: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { supplier: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}

export async function getBill(ctx: Ctx, id: string) {
  const b = await ctx.db.supplierBill.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, supplier: true, payments: { orderBy: { date: "desc" } }, order: { select: { id: true, number: true } } } });
  if (!b) throw notFound("Facture fournisseur");
  return b;
}

export async function createBill(ctx: Ctx, input: z.output<typeof supplierBillSchema>) {
  const supplier = await assertSupplier(ctx, input.supplierId);
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  await assertProject(ctx.db, input.projectId);
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const date = parseDate(input.billDate) ?? new Date();
  const bill = await ctx.db.supplierBill.create({
    data: {
      companyId: ctx.company.id, supplierId: supplier.id, supplierRef: blank(input.supplierRef), status: "DRAFT", billDate: date, dueDate: parseDate(input.dueDate) ?? new Date(date.getTime() + supplier.paymentTermsDays * DAY),
      currency: ctx.company.currency, ...totals, notes: blank(input.notes), costCenterId: input.costCenterId || null, branchId: input.branchId || null, projectId: input.projectId || null, createdById: ctx.user.id,
      lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) },
    },
  });
  await audit(ctx, { action: "supplier_bill.create", resource: "SupplierBill", resourceId: bill.id, summary: `${ctx.user.name} a saisi une facture fournisseur brouillon (${supplier.name}).`, after: { total: totals.total } });
  return bill;
}

export async function updateBill(ctx: Ctx, input: z.output<typeof updateSupplierBillSchema>) {
  const before = await getBill(ctx, input.id);
  if (before.status !== "DRAFT") throw businessRule("Une facture comptabilisée n'est plus modifiable.");
  const supplier = await assertSupplier(ctx, input.supplierId);
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  await assertProject(ctx.db, input.projectId);
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const date = parseDate(input.billDate) ?? before.billDate;
  const after = await ctx.tx(async (tx) => {
    await tx.supplierBillLine.deleteMany({ where: { billId: input.id } });
    return tx.supplierBill.update({
      where: { id: input.id },
      data: { supplierId: supplier.id, supplierRef: blank(input.supplierRef), billDate: date, dueDate: parseDate(input.dueDate) ?? new Date(date.getTime() + supplier.paymentTermsDays * DAY), ...totals, notes: blank(input.notes), costCenterId: input.costCenterId || null, branchId: input.branchId || null, projectId: input.projectId || null, lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) } },
    });
  });
  await audit(ctx, { action: "supplier_bill.update", resource: "SupplierBill", resourceId: after.id, summary: `${ctx.user.name} a modifié une facture fournisseur brouillon.` });
  return after;
}

export async function deleteBill(ctx: Ctx, id: string) {
  const b = await getBill(ctx, id);
  if (b.status !== "DRAFT") throw businessRule("Seule une facture en brouillon peut être supprimée.");
  await ctx.db.supplierBill.delete({ where: { id } });
  await audit(ctx, { action: "supplier_bill.delete", resource: "SupplierBill", resourceId: id, summary: `${ctx.user.name} a supprimé une facture fournisseur brouillon.` });
}

/** Commande → facture fournisseur brouillon : quantités reçues (ou commandées) non encore facturées. */
export async function createBillFromOrder(ctx: Ctx, orderId: string, opts: { onlyReceived?: boolean } = { onlyReceived: true }) {
  const order = await getOrder(ctx, orderId);
  if (["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(order.status)) throw businessRule("La commande doit être validée avant d'être facturée.");
  const rows = order.lines.map((l) => ({ l, qty: (opts.onlyReceived ? d(l.receivedQty) : d(l.quantity)).minus(l.billedQty) })).filter((x) => x.qty.gt(0));
  if (rows.length === 0) throw businessRule(opts.onlyReceived ? "Aucune quantité reçue à facturer." : "Tout est déjà facturé.");
  const date = new Date();
  const lines = rows.map(({ l, qty }, i) => {
    const a = computeLine({ quantity: qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate }, order.currency);
    return { companyId: ctx.company.id, position: i, orderLineId: l.id, productId: l.productId, description: l.description, unit: l.unit, quantity: qty.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), taxId: l.taxId, taxRate: l.taxRate.toString(), netAmount: a.net.toString(), taxAmount: a.tax.toString(), total: a.total.toString(), gross: a.gross, discount: a.discount };
  });
  const sum = (f: (x: (typeof lines)[number]) => unknown) => lines.reduce((a, x) => a.plus(d(f(x) as number)), d(0)).toString();
  const bill = await ctx.db.supplierBill.create({
    data: {
      companyId: ctx.company.id, supplierId: order.supplierId, orderId: order.id, status: "DRAFT", billDate: date, dueDate: new Date(date.getTime() + order.supplier.paymentTermsDays * DAY), currency: order.currency,
      subtotal: sum((x) => x.gross), discountTotal: sum((x) => x.discount), taxTotal: sum((x) => x.taxAmount), total: sum((x) => x.total), createdById: ctx.user.id,
      lines: { create: lines.map(({ gross: _g, discount: _d, ...rest }) => rest) },
    },
  });
  await audit(ctx, { action: "supplier_bill.create", resource: "SupplierBill", resourceId: bill.id, summary: `${ctx.user.name} a créé une facture fournisseur brouillon depuis la commande ${order.number}.` });
  return bill;
}

/** Comptabilisation (validation) de la facture : numéro interne, dette fournisseur, quantités facturées sur la commande. */
export async function postBill(ctx: Ctx, id: string) {
  const b = await getBill(ctx, id);
  if (b.status !== "DRAFT") throw businessRule("Cette facture est déjà comptabilisée.");
  if (b.lines.length === 0 || d(b.total).lte(0)) throw businessRule("Une facture doit avoir un montant positif.");
  if (b.supplierRef) {
    const dup = await ctx.db.supplierBill.findFirst({ where: { supplierId: b.supplierId, supplierRef: b.supplierRef, status: { not: "CANCELLED" }, id: { not: id }, NOT: { status: "DRAFT" } }, select: { number: true } });
    if (dup) throw businessRule(`Doublon : la facture « ${b.supplierRef} » de ${b.supplier.name} est déjà enregistrée (${dup.number}).`);
  }
  const posted = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "supplier_bill", b.billDate);
    const orderIds = new Set<string>();
    for (const l of b.lines) {
      if (!l.orderLineId) continue;
      const ol = await tx.purchaseOrderLine.findFirst({ where: { id: l.orderLineId } });
      if (!ol) continue;
      const next = d(ol.billedQty).plus(l.quantity);
      if (next.gt(ol.quantity)) throw businessRule(`« ${ol.description} » : la quantité facturée dépasserait la commande.`);
      await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { billedQty: next.toString() } });
      orderIds.add(ol.orderId);
    }
    const res = await tx.supplierBill.update({ where: { id }, data: { number, status: "POSTED", postedAt: new Date() } });
    for (const oid of orderIds) await refreshPurchaseOrderStatus(tx, oid);
    await emit(tx, ctx, "supplier_bill.posted", { billId: id });
    return res;
  });
  await audit(ctx, { action: "supplier_bill.post", resource: "SupplierBill", resourceId: id, summary: `${ctx.user.name} a comptabilisé la facture fournisseur ${posted.number} (${b.supplier.name}, ${formatMoney(d(b.total).toNumber(), b.currency)}).` });
  return posted;
}

export async function cancelBill(ctx: Ctx, id: string) {
  const b = await getBill(ctx, id);
  if (b.status === "CANCELLED") throw businessRule("Cette facture est déjà annulée.");
  if (b.status === "DRAFT") throw businessRule("Supprimez le brouillon plutôt que de l'annuler.");
  if (b.payments.some((p) => p.status !== "CANCELLED")) throw businessRule("Des paiements existent : annulez-les d'abord.");
  await ctx.tx(async (tx) => {
    const orderIds = new Set<string>();
    for (const l of b.lines) {
      if (!l.orderLineId) continue;
      const ol = await tx.purchaseOrderLine.findFirst({ where: { id: l.orderLineId } });
      if (!ol) continue;
      await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { billedQty: d(ol.billedQty).minus(l.quantity).toString() } });
      orderIds.add(ol.orderId);
    }
    await tx.supplierBill.update({ where: { id }, data: { status: "CANCELLED" } });
    for (const oid of orderIds) await refreshPurchaseOrderStatus(tx, oid);
    await emit(tx, ctx, "supplier_bill.cancelled", { billId: id });
  });
  await audit(ctx, { action: "supplier_bill.cancel", resource: "SupplierBill", resourceId: id, summary: `${ctx.user.name} a annulé la facture fournisseur ${b.number}.` });
}

// ── Paiements fournisseurs ────────────────────────────────────

async function lockBill(tx: Db, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "SupplierBill" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

async function settleBill(tx: Db, billId: string) {
  const b = await tx.supplierBill.findFirstOrThrow({ where: { id: billId } });
  if (b.status === "DRAFT" || b.status === "CANCELLED") return;
  const status = billBalance(b).lte(0) ? "PAID" : d(b.amountPaid).gt(0) ? "PARTIALLY_PAID" : "POSTED";
  if (status !== b.status) await tx.supplierBill.update({ where: { id: billId }, data: { status } });
}

export async function listSupplierPayments(ctx: Ctx, p: { q?: string; supplierId?: string; skip: number; take: number }) {
  const where = {
    direction: "OUT" as const,
    ...(p.supplierId ? { supplierId: p.supplierId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { reference: { contains: p.q, mode: "insensitive" as const } }, { supplier: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.payment.count({ where }),
    ctx.db.payment.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { supplier: { select: { id: true, name: true } }, bill: { select: { id: true, number: true } } } }),
  ]);
  return { total, rows };
}

/**
 * Effets d'un règlement fournisseur VALIDÉ : réduit la dette de la facture et alimente Finance/Comptabilité (événement).
 * À appeler dans une transaction, sur un paiement « en attente » : soit immédiatement, soit à la décision finale d'une validation.
 */
export async function applySupplierPayment(tx: Db, ctx: Ctx, paymentId: string) {
  const pay = await tx.payment.findFirstOrThrow({ where: { id: paymentId, direction: "OUT" } });
  if (pay.status !== "PENDING" || !pay.billId) throw businessRule("Ce règlement n'est plus en attente.");
  await lockBill(tx, pay.billId);
  const bill = await tx.supplierBill.findFirstOrThrow({ where: { id: pay.billId } });
  if (bill.status !== "POSTED" && bill.status !== "PARTIALLY_PAID") throw businessRule("La facture n'accepte plus de paiement.");
  if (d(pay.amount).gt(billBalance(bill))) throw businessRule(`Le montant dépasse le reste à payer (${formatMoney(billBalance(bill).toNumber(), bill.currency)}).`);
  await tx.payment.update({ where: { id: pay.id }, data: { status: "VALIDATED", validatedAt: new Date(), validatedById: ctx.user.id } });
  await tx.supplierBill.update({ where: { id: bill.id }, data: { amountPaid: d(bill.amountPaid).plus(pay.amount).toString() } });
  await settleBill(tx, bill.id);
  await emit(tx, ctx, "supplier_payment.validated", { paymentId: pay.id });
}

/**
 * Règlement d'une facture fournisseur. Selon les règles de validation de l'entreprise (type « Paiements fournisseurs »), il est soit
 * validé immédiatement (réduit la dette, alimente Finance/Comptabilité), soit mis EN ATTENTE d'approbation : aucun effet financier
 * avant la décision finale ; les paiements en attente sont comptés dans le reste à payer pour éviter de dépasser la dette.
 */
export async function recordSupplierPayment(ctx: Ctx, input: z.output<typeof supplierPaymentSchema>) {
  const bill = await ctx.db.supplierBill.findFirst({ where: { id: input.billId } });
  if (!bill) throw notFound("Facture fournisseur");
  if (bill.status !== "POSTED" && bill.status !== "PARTIALLY_PAID") throw businessRule("Seule une facture comptabilisée et non soldée accepte un paiement.");
  const amount = roundMoney(input.amount, bill.currency);
  if (amount.lte(0)) throw businessRule("Le montant doit être positif.");
  if (input.accountId && !(await ctx.db.financeAccount.findFirst({ where: { id: input.accountId, deletedAt: null, isActive: true }, select: { id: true } }))) throw notFound("Compte");
  const needsApproval = await requiresApproval(ctx, "supplier_payment", amount);
  const payment = await ctx.tx(async (tx) => {
    await lockBill(tx, bill.id);
    const fresh = await tx.supplierBill.findFirstOrThrow({ where: { id: bill.id } });
    const committed = d((await tx.payment.aggregate({ where: { billId: bill.id, direction: "OUT", status: "PENDING" }, _sum: { amount: true } }))._sum.amount ?? 0);
    const available = billBalance(fresh).minus(committed);
    if (amount.gt(available)) throw businessRule(`Le montant dépasse le reste à payer (${formatMoney(available.toNumber(), fresh.currency)}${committed.gt(0) ? `, dont ${formatMoney(committed.toNumber(), fresh.currency)} en attente de validation` : ""}).`);
    const date = parseDate(input.date) ?? new Date();
    const number = await nextNumber(tx, ctx.company.id, "payment_out", date);
    const p = await tx.payment.create({
      data: { companyId: ctx.company.id, number, direction: "OUT", supplierId: bill.supplierId, billId: bill.id, amount: amount.toString(), currency: bill.currency, method: input.method, date, reference: blank(input.reference), accountId: input.accountId || null, notes: blank(input.notes), status: "PENDING", createdById: ctx.user.id },
    });
    if (needsApproval) await requestApproval(tx, ctx, { type: "supplier_payment", resourceId: p.id, title: `Paiement ${number} — facture ${bill.number}`, amount, detail: `${ctx.user.name} demande à régler ${formatMoney(amount.toNumber(), bill.currency)} (facture ${bill.number}).` });
    else await applySupplierPayment(tx, ctx, p.id);
    return tx.payment.findFirstOrThrow({ where: { id: p.id } });
  });
  await audit(ctx, { action: needsApproval ? "supplier_payment.request" : "supplier_payment.create", resource: "Payment", resourceId: payment.id, summary: needsApproval ? `${ctx.user.name} a demandé la validation du règlement de ${formatMoney(amount.toNumber(), bill.currency)} (facture fournisseur ${bill.number}).` : `${ctx.user.name} a réglé ${formatMoney(amount.toNumber(), bill.currency)} sur la facture fournisseur ${bill.number}.`, after: { number: payment.number } });
  return payment;
}

export async function cancelSupplierPayment(ctx: Ctx, id: string) {
  const pay = await ctx.db.payment.findFirst({ where: { id, direction: "OUT" } });
  if (!pay || !pay.billId) throw notFound("Paiement");
  if (pay.status === "CANCELLED") throw businessRule("Ce paiement est déjà annulé.");
  await ctx.tx(async (tx) => {
    if (pay.status === "PENDING") {
      // en attente de validation : aucun effet financier à renverser, on retire simplement la demande
      await cancelApprovals(tx, "supplier_payment", id);
      await tx.payment.update({ where: { id }, data: { status: "CANCELLED" } });
      return;
    }
    await lockBill(tx, pay.billId!);
    const bill = await tx.supplierBill.findFirstOrThrow({ where: { id: pay.billId! } });
    await tx.supplierBill.update({ where: { id: bill.id }, data: { amountPaid: d(bill.amountPaid).minus(pay.amount).toString() } });
    await emit(tx, ctx, "supplier_payment.cancelled", { paymentId: id });
    await tx.payment.update({ where: { id }, data: { status: "CANCELLED" } });
    await settleBill(tx, bill.id);
  });
  await audit(ctx, { action: "supplier_payment.cancel", resource: "Payment", resourceId: id, summary: `${ctx.user.name} a annulé le paiement fournisseur ${pay.number}.` });
}

/** Dettes fournisseurs : encours total et part échue. */
export async function payablesSummary(ctx: Pick<Ctx, "db">) {
  const bills = await ctx.db.supplierBill.findMany({ where: { status: { in: ["POSTED", "PARTIALLY_PAID"] } }, select: { status: true, dueDate: true, total: true, amountPaid: true } });
  let outstanding = d(0), overdue = d(0);
  for (const b of bills) { const bal = billBalance(b); if (bal.gt(0)) { outstanding = outstanding.plus(bal); if (isBillOverdue(b)) overdue = overdue.plus(bal); } }
  return { outstanding, overdue, count: bills.length };
}
