import "server-only";
import { audit } from "@/core/audit";
import { cancelApprovals, requestApproval, requiresApproval } from "@/core/approvals";
import type { Db } from "@/core/db/client";
import { lineData, parseDate, resolveLines } from "@/core/documents/lines";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { d } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import type { purchaseOrderSchema, purchaseRequestSchema, receiptSchema, updatePurchaseOrderSchema, updatePurchaseRequestSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

// ═══ Demandes d'achat ═════════════════════════════════════════

export async function listRequests(ctx: Ctx, p: { q?: string; status?: string; mine?: boolean; skip: number; take: number }) {
  const where = {
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.mine ? { requesterId: ctx.user.id } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { reason: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.purchaseRequest.count({ where }),
    ctx.db.purchaseRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
  ]);
  return { total, rows };
}

export async function getRequest(ctx: Ctx, id: string) {
  const r = await ctx.db.purchaseRequest.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!r) throw notFound("Demande d'achat");
  return r;
}

async function requestLines(ctx: Ctx, lines: z.output<typeof purchaseRequestSchema>["lines"]) {
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => Boolean(x)))];
  if (ids.length && (await ctx.db.product.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length) throw notFound("Produit");
  const estimate = lines.reduce((a, l) => a.plus(d(l.quantity).mul(l.estimatedPrice)), d(0));
  return { estimate: estimate.toString(), data: lines.map((l, i) => ({ companyId: ctx.company.id, position: i, productId: l.productId || null, description: l.description.trim(), unit: l.unit || "unité", quantity: d(l.quantity).toString(), estimatedPrice: d(l.estimatedPrice).toString() })) };
}

export async function createRequest(ctx: Ctx, input: z.output<typeof purchaseRequestSchema>) {
  const { estimate, data } = await requestLines(ctx, input.lines);
  const req = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "purchase_request");
    return tx.purchaseRequest.create({ data: { companyId: ctx.company.id, number, requesterId: ctx.user.id, neededBy: parseDate(input.neededBy), reason: blank(input.reason), estimate, currency: ctx.company.currency, lines: { create: data } } });
  });
  await audit(ctx, { action: "purchase_request.create", resource: "PurchaseRequest", resourceId: req.id, summary: `${ctx.user.name} a créé la demande d'achat ${req.number} (${formatMoney(d(estimate).toNumber(), req.currency)}).`, after: { number: req.number, estimate } });
  return req;
}

function assertOwnerOrManager(ctx: Ctx, requesterId: string) {
  if (requesterId !== ctx.user.id && !ctx.can("purchases.request.approve") && !ctx.access.isAdmin) throw forbidden("Seul l'auteur de la demande peut la modifier.");
}

export async function updateRequest(ctx: Ctx, input: z.output<typeof updatePurchaseRequestSchema>) {
  const before = await getRequest(ctx, input.id);
  assertOwnerOrManager(ctx, before.requesterId);
  if (before.status !== "DRAFT") throw businessRule("Seule une demande en brouillon est modifiable.");
  const { estimate, data } = await requestLines(ctx, input.lines);
  const after = await ctx.tx(async (tx) => {
    await tx.purchaseRequestLine.deleteMany({ where: { requestId: input.id } });
    return tx.purchaseRequest.update({ where: { id: input.id }, data: { neededBy: parseDate(input.neededBy), reason: blank(input.reason), estimate, lines: { create: data } } });
  });
  await audit(ctx, { action: "purchase_request.update", resource: "PurchaseRequest", resourceId: after.id, summary: `${ctx.user.name} a modifié la demande d'achat ${after.number}.` });
  return after;
}

export async function deleteRequest(ctx: Ctx, id: string) {
  const r = await getRequest(ctx, id);
  assertOwnerOrManager(ctx, r.requesterId);
  if (r.status !== "DRAFT") throw businessRule("Seule une demande en brouillon peut être supprimée.");
  await ctx.db.purchaseRequest.delete({ where: { id } });
  await audit(ctx, { action: "purchase_request.delete", resource: "PurchaseRequest", resourceId: id, summary: `${ctx.user.name} a supprimé la demande d'achat ${r.number}.` });
}

/** Soumission : approbation éventuelle selon la règle (seuil), sinon validation directe. */
export async function submitRequest(ctx: Ctx, id: string) {
  const r = await getRequest(ctx, id);
  assertOwnerOrManager(ctx, r.requesterId);
  if (r.status !== "DRAFT") throw businessRule("Cette demande a déjà été soumise.");
  const needs = await requiresApproval(ctx, "purchase_request", r.estimate);
  await ctx.tx(async (tx) => {
    if (needs) {
      await tx.purchaseRequest.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await requestApproval(tx, ctx, { type: "purchase_request", resourceId: id, title: `Demande d'achat ${r.number}`, amount: r.estimate });
    } else {
      await tx.purchaseRequest.update({ where: { id }, data: { status: "APPROVED" } });
    }
  });
  await audit(ctx, { action: "purchase_request.submit", resource: "PurchaseRequest", resourceId: id, summary: `${ctx.user.name} a soumis la demande d'achat ${r.number}${needs ? " à validation" : " (approuvée automatiquement)"}.` });
  return { needsApproval: needs };
}

export async function cancelRequest(ctx: Ctx, id: string) {
  const r = await getRequest(ctx, id);
  assertOwnerOrManager(ctx, r.requesterId);
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(r.status)) throw businessRule("Cette demande ne peut plus être annulée.");
  await ctx.tx(async (tx) => { await tx.purchaseRequest.update({ where: { id }, data: { status: "CANCELLED" } }); await cancelApprovals(tx, "purchase_request", id); });
  await audit(ctx, { action: "purchase_request.cancel", resource: "PurchaseRequest", resourceId: id, summary: `${ctx.user.name} a annulé la demande d'achat ${r.number}.` });
}

/** Demande approuvée → commande fournisseur (brouillon), sans ressaisie. */
export async function convertRequestToOrder(ctx: Ctx, input: { requestId: string; supplierId: string }) {
  const r = await getRequest(ctx, input.requestId);
  if (r.status !== "APPROVED") throw businessRule("Seule une demande approuvée peut être transformée en commande.");
  const supplier = await ctx.db.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null, isActive: true } });
  if (!supplier) throw notFound("Fournisseur");
  const tax = await ctx.db.tax.findFirst({ where: { isDefault: true, isActive: true } });
  const { lines, totals } = await resolveLines(ctx, r.lines.map((l) => ({ productId: l.productId ?? "", description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.estimatedPrice), discountPct: 0, taxId: tax?.id ?? "" })));
  const order = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "purchase_order");
    const o = await tx.purchaseOrder.create({
      data: { companyId: ctx.company.id, number, supplierId: supplier.id, requestId: r.id, status: "DRAFT", currency: ctx.company.currency, ...totals, notes: r.reason, createdById: ctx.user.id, lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) } },
    });
    await tx.purchaseRequest.update({ where: { id: r.id }, data: { status: "ORDERED", orderId: o.id } });
    return o;
  });
  await audit(ctx, { action: "purchase_request.convert", resource: "PurchaseRequest", resourceId: r.id, summary: `${ctx.user.name} a transformé la demande ${r.number} en commande ${order.number}.`, after: { orderId: order.id } });
  return order;
}

// ═══ Commandes fournisseur ════════════════════════════════════

export async function listOrders(ctx: Ctx, p: { q?: string; status?: string; supplierId?: string; skip: number; take: number }) {
  const where = {
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.supplierId ? { supplierId: p.supplierId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { supplier: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.purchaseOrder.count({ where }),
    ctx.db.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { supplier: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}

export async function getOrder(ctx: Ctx, id: string) {
  const o = await ctx.db.purchaseOrder.findFirst({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } }, supplier: true,
      receipts: { orderBy: { createdAt: "desc" }, include: { lines: true } },
      bills: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, supplierRef: true, status: true, total: true, billDate: true } },
    },
  });
  if (!o) throw notFound("Commande fournisseur");
  return o;
}

async function assertSupplier(ctx: Ctx, id: string) {
  const s = await ctx.db.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!s) throw notFound("Fournisseur");
  if (!s.isActive) throw businessRule("Ce fournisseur est inactif.");
  return s;
}

export async function createOrder(ctx: Ctx, input: z.output<typeof purchaseOrderSchema>) {
  const supplier = await assertSupplier(ctx, input.supplierId);
  if (input.warehouseId && !(await ctx.db.warehouse.findFirst({ where: { id: input.warehouseId, deletedAt: null }, select: { id: true } }))) throw notFound("Entrepôt");
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const date = parseDate(input.orderDate) ?? new Date();
  const order = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "purchase_order", date);
    return tx.purchaseOrder.create({
      data: { companyId: ctx.company.id, number, supplierId: supplier.id, status: "DRAFT", orderDate: date, expectedDate: parseDate(input.expectedDate), warehouseId: input.warehouseId || null, currency: ctx.company.currency, ...totals, notes: blank(input.notes), createdById: ctx.user.id, lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) } },
    });
  });
  await audit(ctx, { action: "purchase_order.create", resource: "PurchaseOrder", resourceId: order.id, summary: `${ctx.user.name} a créé la commande fournisseur ${order.number} (${supplier.name}).`, after: { number: order.number, total: totals.total } });
  return order;
}

export async function updateOrder(ctx: Ctx, input: z.output<typeof updatePurchaseOrderSchema>) {
  const before = await getOrder(ctx, input.id);
  if (before.status !== "DRAFT") throw businessRule("Seule une commande en brouillon est modifiable.");
  const supplier = await assertSupplier(ctx, input.supplierId);
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const after = await ctx.tx(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: { orderId: input.id } });
    return tx.purchaseOrder.update({
      where: { id: input.id },
      data: { supplierId: supplier.id, orderDate: parseDate(input.orderDate) ?? before.orderDate, expectedDate: parseDate(input.expectedDate), warehouseId: input.warehouseId || null, ...totals, notes: blank(input.notes), lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) } },
    });
  });
  await audit(ctx, { action: "purchase_order.update", resource: "PurchaseOrder", resourceId: after.id, summary: `${ctx.user.name} a modifié la commande fournisseur ${after.number}.`, before: { total: before.total }, after: { total: totals.total } });
  return after;
}

export async function deleteOrder(ctx: Ctx, id: string) {
  const o = await getOrder(ctx, id);
  if (o.status !== "DRAFT") throw businessRule("Seule une commande en brouillon peut être supprimée.");
  await ctx.tx(async (tx) => {
    if (o.requestId) await tx.purchaseRequest.updateMany({ where: { id: o.requestId, orderId: id }, data: { status: "APPROVED", orderId: null } });
    await tx.purchaseOrder.delete({ where: { id } });
  });
  await audit(ctx, { action: "purchase_order.delete", resource: "PurchaseOrder", resourceId: id, summary: `${ctx.user.name} a supprimé la commande fournisseur ${o.number}.` });
}

/** Validation de la commande : approbation si le montant atteint le seuil, sinon commandée directement. */
export async function submitOrder(ctx: Ctx, id: string) {
  const o = await getOrder(ctx, id);
  if (o.status !== "DRAFT") throw businessRule("Cette commande est déjà validée ou en cours de validation.");
  const needs = await requiresApproval(ctx, "purchase_order", o.total);
  await ctx.tx(async (tx) => {
    if (needs) {
      await tx.purchaseOrder.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      await requestApproval(tx, ctx, { type: "purchase_order", resourceId: id, title: `Commande fournisseur ${o.number} — ${o.supplier.name}`, amount: o.total });
    } else {
      await tx.purchaseOrder.update({ where: { id }, data: { status: "APPROVED" } });
    }
  });
  await audit(ctx, { action: "purchase_order.submit", resource: "PurchaseOrder", resourceId: id, summary: `${ctx.user.name} a ${needs ? "soumis à validation" : "validé"} la commande fournisseur ${o.number}.` });
  return { needsApproval: needs };
}

export async function cancelOrder(ctx: Ctx, id: string) {
  const o = await getOrder(ctx, id);
  if (o.status === "CANCELLED") throw businessRule("Cette commande est déjà annulée.");
  if (o.lines.some((l) => d(l.receivedQty).gt(0) || d(l.billedQty).gt(0)) || o.bills.some((b) => b.status !== "CANCELLED")) throw businessRule("Des réceptions ou factures existent : traitez-les avant d'annuler.");
  await ctx.tx(async (tx) => { await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } }); await cancelApprovals(tx, "purchase_order", id); });
  await audit(ctx, { action: "purchase_order.cancel", resource: "PurchaseOrder", resourceId: id, summary: `${ctx.user.name} a annulé la commande fournisseur ${o.number}.` });
}

export async function refreshPurchaseOrderStatus(tx: Db, orderId: string) {
  const o = await tx.purchaseOrder.findFirst({ where: { id: orderId }, include: { lines: true } });
  if (!o || ["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(o.status)) return;
  const lines = o.lines;
  let status: "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "BILLED" = "APPROVED";
  if (lines.every((l) => d(l.billedQty).gte(l.quantity))) status = "BILLED";
  else if (lines.every((l) => d(l.receivedQty).gte(l.quantity))) status = "RECEIVED";
  else if (lines.some((l) => d(l.receivedQty).gt(0))) status = "PARTIALLY_RECEIVED";
  if (status !== o.status) await tx.purchaseOrder.update({ where: { id: orderId }, data: { status } });
}

// ═══ Réceptions ═══════════════════════════════════════════════

export async function listReceipts(ctx: Ctx, p: { q?: string; orderId?: string; skip: number; take: number }) {
  const where = {
    ...(p.orderId ? { orderId: p.orderId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { supplier: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.goodsReceipt.count({ where }),
    ctx.db.goodsReceipt.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { supplier: { select: { id: true, name: true } }, order: { select: { id: true, number: true } } } }),
  ]);
  return { total, rows };
}

export async function getReceipt(ctx: Ctx, id: string) {
  const r = await ctx.db.goodsReceipt.findFirst({ where: { id }, include: { lines: true, supplier: true, order: { select: { id: true, number: true } } } });
  if (!r) throw notFound("Réception");
  return r;
}

export async function createReceipt(ctx: Ctx, input: z.output<typeof receiptSchema>) {
  const order = await getOrder(ctx, input.orderId);
  if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status)) throw businessRule("Seule une commande validée peut être réceptionnée.");
  if (input.warehouseId && !(await ctx.db.warehouse.findFirst({ where: { id: input.warehouseId, deletedAt: null }, select: { id: true } }))) throw notFound("Entrepôt");
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) throw businessRule("Indiquez au moins une quantité reçue.");
  const byId = new Map(order.lines.map((l) => [l.id, l]));
  const drafts = await ctx.db.goodsReceiptLine.findMany({ where: { orderLineId: { in: [...byId.keys()] }, receipt: { status: "DRAFT" } }, select: { orderLineId: true, quantity: true } });
  const inDraft = new Map<string, ReturnType<typeof d>>();
  for (const x of drafts) inDraft.set(x.orderLineId, (inDraft.get(x.orderLineId) ?? d(0)).plus(x.quantity));
  for (const w of wanted) {
    const l = byId.get(w.orderLineId);
    if (!l) throw notFound("Ligne de commande");
    const remaining = d(l.quantity).minus(l.receivedQty).minus(inDraft.get(l.id) ?? 0);
    if (d(w.quantity).gt(remaining)) throw businessRule(`« ${l.description} » : ${remaining.toString()} restant(s) à recevoir.`);
  }
  const date = parseDate(input.receiptDate) ?? new Date();
  const receipt = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "goods_receipt", date);
    return tx.goodsReceipt.create({
      data: {
        companyId: ctx.company.id, number, orderId: order.id, supplierId: order.supplierId, warehouseId: input.warehouseId || order.warehouseId, status: "DRAFT", receiptDate: date, notes: blank(input.notes), createdById: ctx.user.id,
        lines: { create: wanted.map((w) => { const l = byId.get(w.orderLineId)!; const unitCost = d(l.unitPrice).mul(d(1).minus(d(l.discountPct).div(100))); return { companyId: ctx.company.id, orderLineId: l.id, productId: l.productId, description: l.description, unit: l.unit, quantity: d(w.quantity).toString(), unitCost: unitCost.toString() }; }) },
      },
    });
  });
  await audit(ctx, { action: "goods_receipt.create", resource: "GoodsReceipt", resourceId: receipt.id, summary: `${ctx.user.name} a créé la réception ${receipt.number} (commande ${order.number}).` });
  return receipt;
}

/** Réception confirmée : quantités reçues mises à jour, entrée en stock valorisée (coût moyen) si le module Stock est actif. */
export async function confirmReceipt(ctx: Ctx, id: string) {
  const rc = await getReceipt(ctx, id);
  if (rc.status !== "DRAFT") throw businessRule("Cette réception est déjà traitée.");
  await ctx.tx(async (tx) => {
    const order = await tx.purchaseOrder.findFirstOrThrow({ where: { id: rc.orderId }, include: { lines: true } });
    if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status)) throw businessRule("La commande n'est plus réceptionnable.");
    const byId = new Map(order.lines.map((l) => [l.id, l]));
    for (const l of rc.lines) {
      const ol = byId.get(l.orderLineId);
      if (!ol) throw notFound("Ligne de commande");
      const remaining = d(ol.quantity).minus(ol.receivedQty);
      if (d(l.quantity).gt(remaining)) throw businessRule(`« ${ol.description} » : ${remaining.toString()} restant(s) à recevoir.`);
      await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { receivedQty: d(ol.receivedQty).plus(l.quantity).toString() } });
    }
    await tx.goodsReceipt.update({ where: { id }, data: { status: "RECEIVED" } });
    await emit(tx, ctx, "goods_receipt.confirmed", { receiptId: id });
    await refreshPurchaseOrderStatus(tx, rc.orderId);
  });
  await audit(ctx, { action: "goods_receipt.confirm", resource: "GoodsReceipt", resourceId: id, summary: `${ctx.user.name} a confirmé la réception ${rc.number}.` });
}

export async function deleteReceipt(ctx: Ctx, id: string) {
  const rc = await getReceipt(ctx, id);
  if (rc.status !== "DRAFT") throw businessRule("Seule une réception en brouillon peut être supprimée.");
  await ctx.db.goodsReceipt.delete({ where: { id } });
  await audit(ctx, { action: "goods_receipt.delete", resource: "GoodsReceipt", resourceId: id, summary: `${ctx.user.name} a supprimé la réception ${rc.number}.` });
}
