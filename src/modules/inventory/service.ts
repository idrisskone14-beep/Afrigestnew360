import "server-only";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { assertWithinLimit, getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { d } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import { recordMovement, recordTransfer, stockTotals } from "./stock";
import type {
  categorySchema, countSchema, movementSchema, productSchema, updateCategorySchema, updateProductSchema, updateWarehouseSchema, warehouseSchema,
} from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

// ── Produits ──────────────────────────────────────────────────

export async function listProducts(ctx: Ctx, p: { q?: string; categoryId?: string; type?: "GOODS" | "SERVICE"; lowOnly?: boolean; skip: number; take: number }) {
  const where = {
    deletedAt: null,
    ...(p.categoryId ? { categoryId: p.categoryId } : {}),
    ...(p.type ? { type: p.type } : {}),
    ...(p.q ? { OR: ["name", "sku", "barcode"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.product.count({ where }),
    ctx.db.product.findMany({ where, orderBy: { name: "asc" }, skip: p.skip, take: p.take, include: { category: { select: { name: true } } } }),
  ]);
  const totals = await stockTotals(ctx.db, rows.map((r) => r.id));
  return { total, rows: rows.map((r) => ({ ...r, stock: totals.get(r.id) ?? { quantity: d(0), reserved: d(0) } })) };
}

export async function getProduct(ctx: Ctx, id: string) {
  const product = await ctx.db.product.findFirst({ where: { id, deletedAt: null }, include: { category: true } });
  if (!product) throw notFound("Produit");
  const [levels, movements] = await Promise.all([
    ctx.db.stockLevel.findMany({ where: { productId: id }, include: { warehouse: { select: { name: true, code: true } } }, orderBy: { warehouse: { name: "asc" } } }),
    ctx.db.stockMovement.findMany({ where: { productId: id }, orderBy: { date: "desc" }, take: 30, include: { warehouse: { select: { name: true } } } }),
  ]);
  return { product, levels, movements };
}

async function assertRefs(ctx: Ctx, i: { categoryId?: string; taxId?: string }) {
  if (i.categoryId && !(await ctx.db.productCategory.findFirst({ where: { id: i.categoryId }, select: { id: true } }))) throw notFound("Catégorie");
  if (i.taxId && !(await ctx.db.tax.findFirst({ where: { id: i.taxId }, select: { id: true } }))) throw notFound("Taxe");
}

export async function createProduct(ctx: Ctx, input: z.output<typeof productSchema>) {
  const [limits, usage] = await Promise.all([getEffectiveLimits(ctx.company.id), getUsage(ctx.company.id)]);
  assertWithinLimit(limits, "products", usage.products);
  await assertRefs(ctx, { categoryId: input.categoryId || undefined, taxId: input.taxId || undefined });
  const isGoods = input.type === "GOODS";
  const track = isGoods && input.trackStock;

  const product = await ctx.tx(async (tx) => {
    const sku = blank(input.sku) ?? (await nextNumber(tx, ctx.company.id, "product"));
    const p = await tx.product.create({
      data: {
        companyId: ctx.company.id, sku, name: input.name, description: blank(input.description), type: input.type, categoryId: input.categoryId || null, unit: input.unit,
        barcode: blank(input.barcode), salePrice: d(input.salePrice).toString(), costPrice: d(input.costPrice).toString(), taxId: input.taxId || null,
        trackStock: track, minStock: track ? d(input.minStock).toString() : "0", createdById: ctx.user.id,
      },
    });
    if (track && input.openingWarehouseId && d(input.openingQuantity).isPositive()) {
      await recordMovement(tx, ctx, { productId: p.id, warehouseId: input.openingWarehouseId, type: "IN", delta: input.openingQuantity as number, unitCost: input.costPrice, reason: "Stock initial" });
    }
    return p;
  });
  await audit(ctx, { action: "product.create", resource: "Product", resourceId: product.id, summary: `${ctx.user.name} a créé le produit ${product.name} (${product.sku}).`, after: product });
  return product;
}

export async function updateProduct(ctx: Ctx, input: z.output<typeof updateProductSchema>) {
  const before = await ctx.db.product.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!before) throw notFound("Produit");
  await assertRefs(ctx, { categoryId: input.categoryId || undefined, taxId: input.taxId || undefined });
  const track = input.type === "GOODS" && input.trackStock;
  if (before.trackStock && !track) {
    const t = (await stockTotals(ctx.db, [before.id])).get(before.id);
    if (t && !t.quantity.isZero()) throw businessRule("Ce produit a du stock : ramenez-le à zéro avant de désactiver le suivi de stock.");
  }
  const after = await ctx.db.product.update({
    where: { id: input.id },
    data: {
      sku: blank(input.sku) ?? before.sku, name: input.name, description: blank(input.description), type: input.type, categoryId: input.categoryId || null, unit: input.unit,
      barcode: blank(input.barcode), salePrice: d(input.salePrice).toString(), taxId: input.taxId || null, trackStock: track, minStock: track ? d(input.minStock).toString() : "0", isActive: input.isActive,
      // le coût moyen est piloté par les entrées de stock ; modifiable à la main uniquement sans stock
      ...(track ? {} : { costPrice: d(input.costPrice).toString() }),
    },
  });
  await audit(ctx, { action: "product.update", resource: "Product", resourceId: after.id, summary: `${ctx.user.name} a modifié le produit ${after.name} (${after.sku}).`, before, after });
  return after;
}

export async function archiveProduct(ctx: Ctx, id: string) {
  const p = await ctx.db.product.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw notFound("Produit");
  const t = (await stockTotals(ctx.db, [id])).get(id);
  if (t && !t.quantity.isZero()) throw businessRule("Ce produit a du stock : ramenez-le à zéro avant de l'archiver.");
  await ctx.db.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: "product.delete", resource: "Product", resourceId: id, summary: `${ctx.user.name} a archivé le produit ${p.name} (${p.sku}).`, before: p });
}

// ── Catégories ────────────────────────────────────────────────

export const listCategories = (ctx: Pick<Ctx, "db">) => ctx.db.productCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } });
export const createCategory = (ctx: Ctx, input: z.output<typeof categorySchema>) => ctx.db.productCategory.create({ data: { companyId: ctx.company.id, name: input.name } });
export async function renameCategory(ctx: Ctx, input: z.output<typeof updateCategorySchema>) {
  if (!(await ctx.db.productCategory.findFirst({ where: { id: input.id } }))) throw notFound("Catégorie");
  return ctx.db.productCategory.update({ where: { id: input.id }, data: { name: input.name } });
}
export async function deleteCategory(ctx: Ctx, id: string) {
  if (!(await ctx.db.productCategory.findFirst({ where: { id } }))) throw notFound("Catégorie");
  await ctx.db.productCategory.delete({ where: { id } }); // les produits repassent « sans catégorie »
}

// ── Entrepôts ─────────────────────────────────────────────────

export const listWarehouses = (ctx: Pick<Ctx, "db">) => ctx.db.warehouse.findMany({ where: { deletedAt: null }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });

export async function createWarehouse(ctx: Ctx, input: z.output<typeof warehouseSchema>) {
  const w = await ctx.tx(async (tx) => {
    if (input.isDefault) await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.warehouse.create({ data: { companyId: ctx.company.id, name: input.name, code: input.code.toUpperCase(), address: blank(input.address), isDefault: input.isDefault } });
  });
  await audit(ctx, { action: "warehouse.create", resource: "Warehouse", resourceId: w.id, summary: `${ctx.user.name} a créé l'entrepôt ${w.name}.`, after: w });
  return w;
}

export async function updateWarehouse(ctx: Ctx, input: z.output<typeof updateWarehouseSchema>) {
  const before = await ctx.db.warehouse.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!before) throw notFound("Entrepôt");
  if (!input.isActive && before.isDefault) throw businessRule("L'entrepôt par défaut ne peut pas être désactivé.");
  const after = await ctx.tx(async (tx) => {
    if (input.isDefault) await tx.warehouse.updateMany({ where: { isDefault: true, id: { not: input.id } }, data: { isDefault: false } });
    return tx.warehouse.update({ where: { id: input.id }, data: { name: input.name, code: input.code.toUpperCase(), address: blank(input.address), isDefault: input.isDefault || before.isDefault, isActive: input.isActive } });
  });
  await audit(ctx, { action: "warehouse.update", resource: "Warehouse", resourceId: after.id, summary: `${ctx.user.name} a modifié l'entrepôt ${after.name}.`, before, after });
  return after;
}

export async function archiveWarehouse(ctx: Ctx, id: string) {
  const w = await ctx.db.warehouse.findFirst({ where: { id, deletedAt: null } });
  if (!w) throw notFound("Entrepôt");
  if (w.isDefault) throw businessRule("L'entrepôt par défaut ne peut pas être supprimé.");
  const stock = await ctx.db.stockLevel.aggregate({ where: { warehouseId: id }, _sum: { quantity: true } });
  if (!d(stock._sum.quantity).isZero()) throw businessRule("Cet entrepôt contient du stock : transférez-le avant de le supprimer.");
  await ctx.db.warehouse.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: "warehouse.delete", resource: "Warehouse", resourceId: id, summary: `${ctx.user.name} a supprimé l'entrepôt ${w.name}.`, before: w });
}

// ── Mouvements, inventaire ────────────────────────────────────

export async function manualMovement(ctx: Ctx, input: z.output<typeof movementSchema>) {
  const qty = d(input.quantity);
  const reason = blank(input.reason);
  const result = await ctx.tx(async (tx) => {
    switch (input.kind) {
      case "IN":
      case "RETURN": {
        if (!qty.isPositive()) throw businessRule("La quantité doit être positive.");
        return recordMovement(tx, ctx, { productId: input.productId, warehouseId: input.warehouseId, type: input.kind, delta: qty, unitCost: input.unitCost === "" ? undefined : input.unitCost, reason });
      }
      case "OUT":
        if (!qty.isPositive()) throw businessRule("La quantité doit être positive.");
        return recordMovement(tx, ctx, { productId: input.productId, warehouseId: input.warehouseId, type: "OUT", delta: qty.neg(), reason });
      case "ADJUSTMENT":
        if (!reason) throw businessRule("Un ajustement exige un motif.");
        return recordMovement(tx, ctx, { productId: input.productId, warehouseId: input.warehouseId, type: "ADJUSTMENT", setTo: qty, reason });
      case "TRANSFER": {
        if (!input.toWarehouseId) throw businessRule("Choisissez l'entrepôt de destination.");
        return recordTransfer(tx, ctx, { productId: input.productId, fromWarehouseId: input.warehouseId, toWarehouseId: input.toWarehouseId, quantity: qty, reason });
      }
    }
  });
  await audit(ctx, { action: `stock.${input.kind.toLowerCase()}`, resource: "StockMovement", resourceId: null, summary: `${ctx.user.name} a enregistré un mouvement de stock (${input.kind}).`, after: input });
  return result;
}

/** Inventaire physique : les écarts entre quantités comptées et théoriques deviennent des ajustements tracés. */
export async function applyCount(ctx: Ctx, input: z.output<typeof countSchema>) {
  const reason = blank(input.reason) ?? "Inventaire physique";
  const adjusted = await ctx.tx(async (tx) => {
    let n = 0;
    for (const l of input.lines) {
      const m = await recordMovement(tx, ctx, { productId: l.productId, warehouseId: input.warehouseId, type: "ADJUSTMENT", setTo: l.counted, reason });
      if (m) n++;
    }
    return n;
  });
  await audit(ctx, { action: "stock.count", resource: "Warehouse", resourceId: input.warehouseId, summary: `${ctx.user.name} a validé un inventaire (${adjusted} écart(s) corrigé(s) sur ${input.lines.length} ligne(s)).` });
  return { adjusted };
}

export async function listMovements(ctx: Ctx, p: { productId?: string; warehouseId?: string; type?: "IN" | "OUT" | "TRANSFER" | "ADJUSTMENT" | "RETURN"; skip: number; take: number }) {
  const where = { ...(p.productId ? { productId: p.productId } : {}), ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}), ...(p.type ? { type: p.type } : {}) };
  const [total, rows] = await Promise.all([
    ctx.db.stockMovement.count({ where }),
    ctx.db.stockMovement.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { product: { select: { name: true, sku: true, unit: true } }, warehouse: { select: { name: true } } } }),
  ]);
  return { total, rows };
}

// ── Alertes & valorisation ────────────────────────────────────

export async function lowStockProducts(ctx: Ctx, limit = 50) {
  const rows = await ctx.tx((tx) => tx.$queryRaw<{ id: string; sku: string; name: string; unit: string; minStock: string; qty: string; reserved: string }[]>`
    SELECT p."id", p."sku", p."name", p."unit", p."minStock"::text, COALESCE(SUM(l."quantity"), 0)::text AS qty, COALESCE(SUM(l."reserved"), 0)::text AS reserved
    FROM "Product" p LEFT JOIN "StockLevel" l ON l."productId" = p."id"
    WHERE p."trackStock" AND p."isActive" AND p."deletedAt" IS NULL AND p."minStock" > 0
    GROUP BY p."id"
    HAVING COALESCE(SUM(l."quantity"), 0) - COALESCE(SUM(l."reserved"), 0) <= p."minStock"
    ORDER BY (COALESCE(SUM(l."quantity"), 0) - p."minStock") ASC LIMIT ${limit}`);
  return rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, unit: r.unit, minStock: d(r.minStock), quantity: d(r.qty), reserved: d(r.reserved) }));
}

export async function stockValuation(ctx: Ctx) {
  const rows = await ctx.tx((tx) => tx.$queryRaw<{ id: string; sku: string; name: string; unit: string; qty: string; cost: string }[]>`
    SELECT p."id", p."sku", p."name", p."unit", COALESCE(SUM(l."quantity"), 0)::text AS qty, p."costPrice"::text AS cost
    FROM "Product" p JOIN "StockLevel" l ON l."productId" = p."id"
    WHERE p."trackStock" AND p."deletedAt" IS NULL
    GROUP BY p."id" HAVING COALESCE(SUM(l."quantity"), 0) <> 0 ORDER BY p."name"`);
  const lines = rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, unit: r.unit, quantity: d(r.qty), cost: d(r.cost), value: d(r.qty).mul(d(r.cost)) }));
  return { lines, total: lines.reduce((a, l) => a.plus(l.value), d(0)) };
}
