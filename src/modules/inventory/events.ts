import "server-only";
import { on } from "@/core/events";
import { d } from "@/core/money";
import { recordMovement, releaseReservation, reserveStock } from "./stock";

/**
 * Le module Stock s'abonne aux événements de Ventes/Achats. Chaque abonné ne fait rien si le module
 * Stock n'est pas actif pour l'entreprise ou si la ligne concerne un service / un produit non suivi.
 */
const active = (ctx: { hasModule: (k: string) => boolean }) => ctx.hasModule("inventory");

async function defaultWarehouseId(tx: Parameters<Parameters<typeof on>[1]>[0]) {
  const w = await tx.warehouse.findFirst({ where: { deletedAt: null, isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return w?.id ?? null;
}

async function trackedProducts(tx: Parameters<Parameters<typeof on>[1]>[0], ids: (string | null)[]) {
  const productIds = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const products = await tx.product.findMany({ where: { id: { in: productIds }, deletedAt: null, trackStock: true } });
  return new Map(products.map((p) => [p.id, p]));
}

// Commande confirmée → réservation du stock disponible
on("order.confirmed", async (tx, ctx, { orderId }) => {
  if (!active(ctx)) return;
  const order = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId }, include: { lines: true } });
  const tracked = await trackedProducts(tx, order.lines.map((l) => l.productId));
  if (tracked.size === 0) return;
  const warehouseId = order.warehouseId ?? (await defaultWarehouseId(tx));
  if (!warehouseId) return;
  if (!order.warehouseId) await tx.salesOrder.update({ where: { id: orderId }, data: { warehouseId } });
  for (const l of order.lines) {
    if (l.productId && tracked.has(l.productId)) await reserveStock(tx, ctx, { productId: l.productId, warehouseId, quantity: l.quantity });
  }
});

// Commande annulée → libération du reliquat réservé
on("order.cancelled", async (tx, ctx, { orderId }) => {
  if (!active(ctx)) return;
  const order = await tx.salesOrder.findFirstOrThrow({ where: { id: orderId }, include: { lines: true } });
  if (!order.warehouseId) return;
  const tracked = await trackedProducts(tx, order.lines.map((l) => l.productId));
  for (const l of order.lines) {
    const remaining = d(l.quantity).minus(l.deliveredQty);
    if (l.productId && tracked.has(l.productId) && remaining.isPositive()) await releaseReservation(tx, ctx, { productId: l.productId, warehouseId: order.warehouseId, quantity: remaining });
  }
});

// Livraison confirmée → sortie de stock (et fin de la réservation correspondante)
on("delivery.confirmed", async (tx, ctx, { deliveryId }) => {
  if (!active(ctx)) return;
  const delivery = await tx.delivery.findFirstOrThrow({ where: { id: deliveryId }, include: { lines: true, order: { select: { warehouseId: true } } } });
  const tracked = await trackedProducts(tx, delivery.lines.map((l) => l.productId));
  if (tracked.size === 0) return;
  const warehouseId = delivery.warehouseId ?? delivery.order.warehouseId ?? (await defaultWarehouseId(tx));
  if (!warehouseId) return;
  for (const l of delivery.lines) {
    if (!l.productId || !tracked.has(l.productId)) continue;
    // la réservation de la commande est consommée avant la sortie (sinon le disponible serait compté deux fois)
    if (delivery.order.warehouseId === warehouseId) await releaseReservation(tx, ctx, { productId: l.productId, warehouseId, quantity: l.quantity });
    await recordMovement(tx, ctx, { productId: l.productId, warehouseId, type: "OUT", delta: d(l.quantity).neg(), skipCost: true, reference: delivery.number, sourceType: "delivery", sourceId: delivery.id, reason: "Livraison client" });
  }
});

// Avoir avec retour en stock → entrée de type RETOUR
on("credit_note.issued", async (tx, ctx, { creditNoteId }) => {
  if (!active(ctx)) return;
  const cn = await tx.creditNote.findFirstOrThrow({ where: { id: creditNoteId }, include: { lines: true } });
  if (!cn.restock) return;
  const tracked = await trackedProducts(tx, cn.lines.map((l) => l.productId));
  const warehouseId = await defaultWarehouseId(tx);
  if (tracked.size === 0 || !warehouseId) return;
  for (const l of cn.lines) {
    if (l.productId && tracked.has(l.productId)) {
      await recordMovement(tx, ctx, { productId: l.productId, warehouseId, type: "RETURN", delta: l.quantity, skipCost: true, reference: cn.number, sourceType: "credit_note", sourceId: cn.id, reason: "Retour client (avoir)" });
    }
  }
});

// Réception confirmée → entrée en stock, valorisée au coût net de la commande (coût moyen pondéré)
on("goods_receipt.confirmed", async (tx, ctx, { receiptId }) => {
  if (!active(ctx)) return;
  const rc = await tx.goodsReceipt.findFirstOrThrow({ where: { id: receiptId }, include: { lines: true, order: { select: { warehouseId: true } } } });
  const tracked = await trackedProducts(tx, rc.lines.map((l) => l.productId));
  if (tracked.size === 0) return;
  const warehouseId = rc.warehouseId ?? rc.order.warehouseId ?? (await defaultWarehouseId(tx));
  if (!warehouseId) return;
  for (const l of rc.lines) {
    if (!l.productId || !tracked.has(l.productId)) continue;
    await recordMovement(tx, ctx, { productId: l.productId, warehouseId, type: "IN", delta: l.quantity, unitCost: l.unitCost, reference: rc.number, sourceType: "goods_receipt", sourceId: rc.id, reason: "Réception fournisseur" });
  }
});
