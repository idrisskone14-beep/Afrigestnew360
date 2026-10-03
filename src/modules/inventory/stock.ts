import "server-only";
import type { Db } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";
import { Decimal, d, type Numeric } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";

/**
 * Moteur de stock. Toute variation de quantité passe par `recordMovement` : verrou de ligne
 * (SELECT … FOR UPDATE) → contrôle du disponible → mise à jour du niveau → coût moyen pondéré → mouvement tracé.
 * À appeler UNIQUEMENT dans une transaction `ctx.tx` (le contexte RLS y est posé).
 */
type StockCtx = Pick<TenantContext, "company" | "user">;

export interface MovementInput {
  productId: string;
  warehouseId: string;
  type: "IN" | "OUT" | "TRANSFER" | "ADJUSTMENT" | "RETURN";
  /** Variation signée (+ entrée, − sortie). Exclusif avec `setTo`. */
  delta?: Numeric;
  /** Inventaire : quantité comptée → l'écart est calculé sous verrou. */
  setTo?: Numeric;
  unitCost?: Numeric;
  /** Ne recalcule pas le coût moyen (transferts, sorties). */
  skipCost?: boolean;
  reference?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  reason?: string | null;
  transferGroupId?: string | null;
  date?: Date;
}

async function lockLevel(tx: Db, companyId: string, productId: string, warehouseId: string) {
  await tx.$executeRaw`
    INSERT INTO "StockLevel" ("id", "companyId", "productId", "warehouseId", "quantity", "reserved", "updatedAt")
    VALUES (gen_random_uuid(), ${companyId}::uuid, ${productId}::uuid, ${warehouseId}::uuid, 0, 0, now())
    ON CONFLICT ("productId", "warehouseId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; quantity: Decimal; reserved: Decimal }[]>`
    SELECT "id", "quantity", "reserved" FROM "StockLevel"
    WHERE "productId" = ${productId}::uuid AND "warehouseId" = ${warehouseId}::uuid FOR UPDATE`;
  const row = rows[0]!;
  return { id: row.id, quantity: d(row.quantity), reserved: d(row.reserved) };
}

export async function recordMovement(tx: Db, ctx: StockCtx, input: MovementInput) {
  const product = await tx.product.findFirst({ where: { id: input.productId, deletedAt: null } });
  if (!product) throw notFound("Produit");
  if (!product.trackStock || product.type === "SERVICE") throw businessRule(`« ${product.name} » n'est pas géré en stock.`);
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, deletedAt: null } });
  if (!warehouse) throw notFound("Entrepôt");

  const level = await lockLevel(tx, ctx.company.id, product.id, warehouse.id);
  const delta = input.setTo !== undefined ? d(input.setTo).minus(level.quantity) : d(input.delta);
  if (input.setTo !== undefined && d(input.setTo).isNegative()) throw businessRule("La quantité comptée ne peut pas être négative.");
  if (delta.isZero()) return null;

  const newQty = level.quantity.plus(delta);
  const company = await tx.company.findFirst({ where: { id: ctx.company.id }, select: { allowNegativeStock: true } });
  if (newQty.isNegative() && delta.isNegative() && !company?.allowNegativeStock) {
    throw businessRule(`Stock insuffisant pour « ${product.name} » dans « ${warehouse.name} » : ${level.quantity.toString()} ${product.unit} disponible(s).`);
  }

  await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: newQty.toString() } });

  let cost = d(product.costPrice);
  if (delta.isPositive() && input.unitCost !== undefined && input.unitCost !== null && !input.skipCost) {
    const totals = await tx.stockLevel.aggregate({ where: { productId: product.id }, _sum: { quantity: true } });
    // total AVANT cette entrée (le niveau de cet entrepôt vient d'être mis à jour)
    const before = d(totals._sum.quantity).minus(delta);
    const incoming = d(input.unitCost);
    cost = before.isPositive() ? before.mul(cost).plus(delta.mul(incoming)).div(before.plus(delta)) : incoming;
    cost = cost.toDecimalPlaces(4);
    await tx.product.update({ where: { id: product.id }, data: { costPrice: cost.toString() } });
  }

  return tx.stockMovement.create({
    data: {
      companyId: ctx.company.id, productId: product.id, warehouseId: warehouse.id, type: input.type, quantity: delta.toString(),
      unitCost: (input.unitCost !== undefined && input.unitCost !== null ? d(input.unitCost) : cost).toString(),
      reference: input.reference ?? null, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, reason: input.reason ?? null,
      transferGroupId: input.transferGroupId ?? null, date: input.date ?? new Date(), createdById: ctx.user.id,
    },
  });
}

/** Transfert entre entrepôts : deux mouvements liés, valorisation inchangée. */
export async function recordTransfer(tx: Db, ctx: StockCtx, input: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: Numeric; reason?: string | null; reference?: string | null }) {
  if (input.fromWarehouseId === input.toWarehouseId) throw businessRule("Les entrepôts source et destination doivent être différents.");
  const qty = d(input.quantity);
  if (!qty.isPositive()) throw businessRule("La quantité doit être positive.");
  const group = crypto.randomUUID();
  const common = { productId: input.productId, type: "TRANSFER" as const, skipCost: true, reason: input.reason ?? null, reference: input.reference ?? null, transferGroupId: group };
  const out = await recordMovement(tx, ctx, { ...common, warehouseId: input.fromWarehouseId, delta: qty.neg() });
  const into = await recordMovement(tx, ctx, { ...common, warehouseId: input.toWarehouseId, delta: qty });
  return { out, into, group };
}

/** Réservation pour une commande client (stock « réservé » ≠ disponible). */
export async function reserveStock(tx: Db, ctx: StockCtx, input: { productId: string; warehouseId: string; quantity: Numeric }) {
  const level = await lockLevel(tx, ctx.company.id, input.productId, input.warehouseId);
  const qty = d(input.quantity);
  const company = await tx.company.findFirst({ where: { id: ctx.company.id }, select: { allowNegativeStock: true } });
  if (!company?.allowNegativeStock && level.quantity.minus(level.reserved).lt(qty)) {
    const p = await tx.product.findFirst({ where: { id: input.productId }, select: { name: true, unit: true } });
    throw businessRule(`Stock disponible insuffisant pour « ${p?.name ?? "produit"} » : ${level.quantity.minus(level.reserved).toString()} ${p?.unit ?? ""} disponible(s).`);
  }
  await tx.stockLevel.update({ where: { id: level.id }, data: { reserved: level.reserved.plus(qty).toString() } });
}

export async function releaseReservation(tx: Db, ctx: StockCtx, input: { productId: string; warehouseId: string; quantity: Numeric }) {
  const level = await lockLevel(tx, ctx.company.id, input.productId, input.warehouseId);
  const next = Decimal.max(level.reserved.minus(d(input.quantity)), 0);
  await tx.stockLevel.update({ where: { id: level.id }, data: { reserved: next.toString() } });
}

export async function stockTotals(db: Pick<Db, "stockLevel">, productIds: string[]) {
  const rows = await db.stockLevel.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _sum: { quantity: true, reserved: true } });
  return new Map(rows.map((r) => [r.productId, { quantity: d(r._sum.quantity), reserved: d(r._sum.reserved) }]));
}
