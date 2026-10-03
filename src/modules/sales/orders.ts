import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { emit } from "@/core/events";
import { businessRule, notFound } from "@/core/errors";
import { d } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import type { z } from "zod";
import { lineData, parseDate, resolveLines } from "@/core/documents/lines";
import type { deliverySchema, orderSchema, updateOrderSchema } from "./schemas";

type Ctx = TenantContext;
export type OrderStatusT = "DRAFT" | "CONFIRMED" | "PARTIALLY_DELIVERED" | "DELIVERED" | "INVOICED" | "CANCELLED";
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

async function assertCustomer(ctx: Ctx, customerId: string) {
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!c) throw notFound("Client");
  if (!c.isActive) throw businessRule("Ce client est inactif.");
  return c;
}

export async function listOrders(ctx: Ctx, p: { q?: string; status?: OrderStatusT; customerId?: string; skip: number; take: number }) {
  const where = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.customerId ? { customerId: p.customerId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { customer: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.salesOrder.count({ where }),
    ctx.db.salesOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { customer: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}

export async function getOrder(ctx: Ctx, id: string) {
  const o = await ctx.db.salesOrder.findFirst({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } }, customer: true,
      deliveries: { orderBy: { createdAt: "desc" }, include: { lines: true } },
      invoices: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, total: true, issueDate: true } },
    },
  });
  if (!o) throw notFound("Commande");
  return o;
}

export async function createOrder(ctx: Ctx, input: z.output<typeof orderSchema>) {
  const customer = await assertCustomer(ctx, input.customerId);
  if (input.warehouseId && !(await ctx.db.warehouse.findFirst({ where: { id: input.warehouseId, deletedAt: null }, select: { id: true } }))) throw notFound("Entrepôt");
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const date = parseDate(input.orderDate) ?? new Date();
  const order = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "order", date);
    return tx.salesOrder.create({
      data: {
        companyId: ctx.company.id, number, customerId: customer.id, status: "DRAFT", orderDate: date, expectedDelivery: parseDate(input.expectedDelivery), warehouseId: input.warehouseId || null,
        currency: ctx.company.currency, ...totals, notes: blank(input.notes), createdById: ctx.user.id,
        lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) },
      },
    });
  });
  await audit(ctx, { action: "order.create", resource: "SalesOrder", resourceId: order.id, summary: `${ctx.user.name} a créé la commande ${order.number} pour ${customer.name}.`, after: { number: order.number, total: totals.total } });
  return order;
}

export async function updateOrder(ctx: Ctx, input: z.output<typeof updateOrderSchema>) {
  const before = await getOrder(ctx, input.id);
  if (before.status !== "DRAFT") throw businessRule("Seule une commande en brouillon est modifiable.");
  const customer = await assertCustomer(ctx, input.customerId);
  const { lines, totals } = await resolveLines(ctx, input.lines);
  const after = await ctx.tx(async (tx) => {
    await tx.orderLine.deleteMany({ where: { orderId: input.id } });
    return tx.salesOrder.update({
      where: { id: input.id },
      data: {
        customerId: customer.id, orderDate: parseDate(input.orderDate) ?? before.orderDate, expectedDelivery: parseDate(input.expectedDelivery), warehouseId: input.warehouseId || null,
        ...totals, notes: blank(input.notes), lines: { create: lines.map((l) => ({ companyId: ctx.company.id, ...lineData(l) })) },
      },
    });
  });
  await audit(ctx, { action: "order.update", resource: "SalesOrder", resourceId: after.id, summary: `${ctx.user.name} a modifié la commande ${after.number}.`, before: { total: before.total }, after: { total: totals.total } });
  return after;
}

export async function confirmOrder(ctx: Ctx, id: string) {
  const o = await getOrder(ctx, id);
  if (o.status !== "DRAFT") throw businessRule("Cette commande est déjà confirmée.");
  await ctx.tx(async (tx) => {
    await tx.salesOrder.update({ where: { id }, data: { status: "CONFIRMED" } });
    await emit(tx, ctx, "order.confirmed", { orderId: id });
  });
  await audit(ctx, { action: "order.confirm", resource: "SalesOrder", resourceId: id, summary: `${ctx.user.name} a confirmé la commande ${o.number}.` });
}

export async function cancelOrder(ctx: Ctx, id: string) {
  const o = await getOrder(ctx, id);
  if (o.status === "CANCELLED") throw businessRule("Cette commande est déjà annulée.");
  if (o.lines.some((l) => d(l.deliveredQty).gt(0) || d(l.invoicedQty).gt(0))) throw businessRule("Des livraisons ou factures existent : annulez-les avant (ou émettez un avoir).");
  if (o.deliveries.some((x) => x.status === "DRAFT")) throw businessRule("Supprimez d'abord les bons de livraison en brouillon.");
  await ctx.tx(async (tx) => {
    if (o.status === "CONFIRMED") await emit(tx, ctx, "order.cancelled", { orderId: id });
    await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  });
  await audit(ctx, { action: "order.cancel", resource: "SalesOrder", resourceId: id, summary: `${ctx.user.name} a annulé la commande ${o.number}.` });
}

export async function deleteOrder(ctx: Ctx, id: string) {
  const o = await getOrder(ctx, id);
  if (o.status !== "DRAFT") throw businessRule("Seule une commande en brouillon peut être supprimée.");
  await ctx.db.salesOrder.delete({ where: { id } });
  await audit(ctx, { action: "order.delete", resource: "SalesOrder", resourceId: id, summary: `${ctx.user.name} a supprimé la commande ${o.number}.` });
}

/** Recalcule le statut d'une commande d'après les quantités livrées / facturées. */
export async function refreshOrderStatus(tx: Db, orderId: string) {
  const o = await tx.salesOrder.findFirst({ where: { id: orderId }, include: { lines: true } });
  if (!o || o.status === "CANCELLED" || o.status === "DRAFT") return;
  const lines = o.lines;
  const all = (f: (l: (typeof lines)[number]) => boolean) => lines.every(f);
  let status: "CONFIRMED" | "PARTIALLY_DELIVERED" | "DELIVERED" | "INVOICED" = "CONFIRMED";
  if (all((l) => d(l.invoicedQty).gte(l.quantity))) status = "INVOICED";
  else if (all((l) => d(l.deliveredQty).gte(l.quantity))) status = "DELIVERED";
  else if (lines.some((l) => d(l.deliveredQty).gt(0))) status = "PARTIALLY_DELIVERED";
  if (status !== o.status) await tx.salesOrder.update({ where: { id: orderId }, data: { status } });
}

// ── Livraisons ────────────────────────────────────────────────

export async function listDeliveries(ctx: Ctx, p: { q?: string; orderId?: string; skip: number; take: number }) {
  const where = {
    ...(p.orderId ? { orderId: p.orderId } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { customer: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.delivery.count({ where }),
    ctx.db.delivery.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { customer: { select: { id: true, name: true } }, order: { select: { id: true, number: true } } } }),
  ]);
  return { total, rows };
}

export async function getDelivery(ctx: Ctx, id: string) {
  const dl = await ctx.db.delivery.findFirst({ where: { id }, include: { lines: true, customer: true, order: { select: { id: true, number: true } } } });
  if (!dl) throw notFound("Bon de livraison");
  return dl;
}

export async function createDelivery(ctx: Ctx, input: z.output<typeof deliverySchema>) {
  const order = await getOrder(ctx, input.orderId);
  if (!["CONFIRMED", "PARTIALLY_DELIVERED"].includes(order.status)) throw businessRule("Seule une commande confirmée peut être livrée.");
  if (input.warehouseId && !(await ctx.db.warehouse.findFirst({ where: { id: input.warehouseId, deletedAt: null }, select: { id: true } }))) throw notFound("Entrepôt");
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) throw businessRule("Indiquez au moins une quantité à livrer.");
  const byId = new Map(order.lines.map((l) => [l.id, l]));
  // les bons de livraison en brouillon réservent déjà une partie du reste à livrer
  const drafts = await ctx.db.deliveryLine.findMany({ where: { orderLineId: { in: [...byId.keys()] }, delivery: { status: "DRAFT" } }, select: { orderLineId: true, quantity: true } });
  const inDraft = new Map<string, ReturnType<typeof d>>();
  for (const x of drafts) inDraft.set(x.orderLineId, (inDraft.get(x.orderLineId) ?? d(0)).plus(x.quantity));
  for (const w of wanted) {
    const l = byId.get(w.orderLineId);
    if (!l) throw notFound("Ligne de commande");
    const remaining = d(l.quantity).minus(l.deliveredQty).minus(inDraft.get(l.id) ?? 0);
    if (d(w.quantity).gt(remaining)) throw businessRule(`« ${l.description} » : ${remaining.toString()} restant(s) à livrer.`);
  }
  const date = parseDate(input.deliveryDate) ?? new Date();
  const delivery = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "delivery", date);
    return tx.delivery.create({
      data: {
        companyId: ctx.company.id, number, orderId: order.id, customerId: order.customerId, warehouseId: input.warehouseId || order.warehouseId, status: "DRAFT", deliveryDate: date, notes: blank(input.notes), createdById: ctx.user.id,
        lines: { create: wanted.map((w) => { const l = byId.get(w.orderLineId)!; return { companyId: ctx.company.id, orderLineId: l.id, productId: l.productId, description: l.description, unit: l.unit, quantity: d(w.quantity).toString() }; }) },
      },
    });
  });
  await audit(ctx, { action: "delivery.create", resource: "Delivery", resourceId: delivery.id, summary: `${ctx.user.name} a créé le bon de livraison ${delivery.number} (commande ${order.number}).` });
  return delivery;
}

/** Livraison confirmée : quantités livrées mises à jour, sortie de stock automatique (si Stock actif). */
export async function confirmDelivery(ctx: Ctx, id: string) {
  const dl = await getDelivery(ctx, id);
  if (dl.status !== "DRAFT") throw businessRule("Ce bon de livraison est déjà traité.");
  await ctx.tx(async (tx) => {
    const order = await tx.salesOrder.findFirstOrThrow({ where: { id: dl.orderId }, include: { lines: true } });
    if (!["CONFIRMED", "PARTIALLY_DELIVERED"].includes(order.status)) throw businessRule("La commande n'est plus livrable.");
    const byId = new Map(order.lines.map((l) => [l.id, l]));
    for (const l of dl.lines) {
      const ol = byId.get(l.orderLineId);
      if (!ol) throw notFound("Ligne de commande");
      const remaining = d(ol.quantity).minus(ol.deliveredQty);
      if (d(l.quantity).gt(remaining)) throw businessRule(`« ${ol.description} » : ${remaining.toString()} restant(s) à livrer.`);
      await tx.orderLine.update({ where: { id: ol.id }, data: { deliveredQty: d(ol.deliveredQty).plus(l.quantity).toString() } });
    }
    await tx.delivery.update({ where: { id }, data: { status: "DELIVERED" } });
    await emit(tx, ctx, "delivery.confirmed", { deliveryId: id });
    await refreshOrderStatus(tx, dl.orderId);
  });
  await audit(ctx, { action: "delivery.confirm", resource: "Delivery", resourceId: id, summary: `${ctx.user.name} a confirmé la livraison ${dl.number}.` });
}

export async function deleteDelivery(ctx: Ctx, id: string) {
  const dl = await getDelivery(ctx, id);
  if (dl.status !== "DRAFT") throw businessRule("Seul un bon de livraison en brouillon peut être supprimé.");
  await ctx.db.delivery.delete({ where: { id } });
  await audit(ctx, { action: "delivery.delete", resource: "Delivery", resourceId: id, summary: `${ctx.user.name} a supprimé le bon de livraison ${dl.number}.` });
}
