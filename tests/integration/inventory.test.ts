import { describe, expect, it } from "vitest";
import { platformDb, tenantTransaction } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as inv from "@/modules/inventory/service";
import { productSchema } from "@/modules/inventory/schemas";
import { recordMovement, releaseReservation, reserveStock } from "@/modules/inventory/stock";
import { ctxFor, makeCompany } from "../helpers";

const prod = (over: Record<string, unknown> = {}) =>
  productSchema.parse({ name: "Ciment 50kg", type: "GOODS", unit: "sac", salePrice: 6500, costPrice: 5000, trackStock: true, minStock: 10, ...over });

async function setup(plan = "enterprise") {
  const co = await makeCompany("INV", plan);
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const main = (await inv.listWarehouses(ctx))[0]!;
  return { ...co, ctx, main };
}

const qty = async (ctx: Awaited<ReturnType<typeof ctxFor>>, productId: string, warehouseId?: string) =>
  Number((await ctx.db.stockLevel.aggregate({ where: { productId, ...(warehouseId ? { warehouseId } : {}) }, _sum: { quantity: true } }))._sum.quantity ?? 0);

describe("produits", () => {
  it("référence automatique, stock initial tracé, unicité de la référence", async () => {
    const { ctx, main } = await setup();
    const p = await inv.createProduct(ctx, prod({ openingWarehouseId: main.id, openingQuantity: 40 }));
    expect(p.sku).toMatch(/^PRD-\d{5}$/);
    expect(await qty(ctx, p.id)).toBe(40);
    const detail = await inv.getProduct(ctx, p.id);
    expect(detail.movements).toHaveLength(1);
    expect(detail.movements[0]).toMatchObject({ type: "IN", reason: "Stock initial" });
    await inv.createProduct(ctx, prod({ name: "Manuel", sku: "CIM-001" }));
    await expect(inv.createProduct(ctx, prod({ name: "Doublon", sku: "CIM-001" }))).rejects.toBeTruthy();
  });

  it("un service n'est pas géré en stock", async () => {
    const { ctx, main } = await setup();
    const s = await inv.createProduct(ctx, prod({ name: "Livraison", type: "SERVICE", trackStock: true, minStock: 5 }));
    expect(s).toMatchObject({ trackStock: false, type: "SERVICE" });
    await expect(inv.manualMovement(ctx, { kind: "IN", productId: s.id, warehouseId: main.id, quantity: 1 } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("respecte la limite de produits ; un produit archivé libère de la place ; archivage refusé avec du stock", async () => {
    const { ctx, company, main } = await setup();
    await platformDb.usageLimit.create({ data: { companyId: company.id, key: "products", value: 2 } });
    const a = await inv.createProduct(ctx, prod({ name: "Prod A", openingWarehouseId: main.id, openingQuantity: 3 }));
    const b = await inv.createProduct(ctx, prod({ name: "Prod B" }));
    await expect(inv.createProduct(ctx, prod({ name: "Prod C" }))).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    await expect(inv.archiveProduct(ctx, a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await inv.archiveProduct(ctx, b.id);
    await inv.createProduct(ctx, prod({ name: "Prod C" }));
  });

  it("recherche par nom, référence ou code-barres ; totaux de stock", async () => {
    const { ctx, main } = await setup();
    const p = await inv.createProduct(ctx, prod({ name: "Peinture blanche", barcode: "6001234567890", openingWarehouseId: main.id, openingQuantity: 7 }));
    for (const q of ["peinture", p.sku.toLowerCase(), "6001234"]) {
      const r = await inv.listProducts(ctx, { q, skip: 0, take: 10 });
      expect(r.rows.map((x) => x.id), q).toContain(p.id);
    }
    expect((await inv.listProducts(ctx, { q: "peinture", skip: 0, take: 10 })).rows[0]!.stock.quantity.toString()).toBe("7");
  });
});

describe("mouvements de stock", () => {
  it("entrées valorisées : coût moyen pondéré", async () => {
    const { ctx, main } = await setup();
    const p = await inv.createProduct(ctx, prod({ costPrice: 1000, openingWarehouseId: main.id, openingQuantity: 10 }));
    await inv.manualMovement(ctx, { kind: "IN", productId: p.id, warehouseId: main.id, quantity: 10, unitCost: 2000 } as never);
    expect(Number((await inv.getProduct(ctx, p.id)).product.costPrice)).toBe(1500);
    await inv.manualMovement(ctx, { kind: "IN", productId: p.id, warehouseId: main.id, quantity: 20, unitCost: 1800 } as never);
    // (20×1500 + 20×1800) / 40 = 1650
    expect(Number((await inv.getProduct(ctx, p.id)).product.costPrice)).toBe(1650);
    // une sortie ne change pas le coût
    await inv.manualMovement(ctx, { kind: "OUT", productId: p.id, warehouseId: main.id, quantity: 5 } as never);
    expect(Number((await inv.getProduct(ctx, p.id)).product.costPrice)).toBe(1650);
  });

  it("refuse une sortie supérieure au stock (sauf autorisation du stock négatif)", async () => {
    const { ctx, company, main } = await setup();
    const p = await inv.createProduct(ctx, prod({ openingWarehouseId: main.id, openingQuantity: 3 }));
    await expect(inv.manualMovement(ctx, { kind: "OUT", productId: p.id, warehouseId: main.id, quantity: 4 } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Stock insuffisant") });
    expect(await qty(ctx, p.id)).toBe(3);
    await platformDb.company.update({ where: { id: company.id }, data: { allowNegativeStock: true } });
    const ctx2 = await ctxFor(ctx.user.id, company.id);
    await inv.manualMovement(ctx2, { kind: "OUT", productId: p.id, warehouseId: main.id, quantity: 4 } as never);
    expect(await qty(ctx2, p.id)).toBe(-1);
  });

  it("CONCURRENCE : 12 sorties simultanées sur un stock de 5 → exactement 5 réussissent, jamais de stock négatif", async () => {
    const { ctx, main } = await setup();
    const p = await inv.createProduct(ctx, prod({ openingWarehouseId: main.id, openingQuantity: 5 }));
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => inv.manualMovement(ctx, { kind: "OUT", productId: p.id, warehouseId: main.id, quantity: 1 } as never)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await qty(ctx, p.id)).toBe(0);
    expect((await inv.listMovements(ctx, { productId: p.id, type: "OUT", skip: 0, take: 50 })).total).toBe(5);
  });

  it("transfert : deux mouvements liés, total inchangé, valorisation inchangée, atomique", async () => {
    const { ctx, main } = await setup();
    const second = await inv.createWarehouse(ctx, { name: "Dépôt Nord", code: "nord", isDefault: false });
    expect(second.code).toBe("NORD");
    const p = await inv.createProduct(ctx, prod({ costPrice: 1200, openingWarehouseId: main.id, openingQuantity: 10 }));
    const before = (await inv.stockValuation(ctx)).total.toNumber();
    await inv.manualMovement(ctx, { kind: "TRANSFER", productId: p.id, warehouseId: main.id, toWarehouseId: second.id, quantity: 4 } as never);
    expect(await qty(ctx, p.id, main.id)).toBe(6);
    expect(await qty(ctx, p.id, second.id)).toBe(4);
    expect((await inv.stockValuation(ctx)).total.toNumber()).toBe(before);
    const mv = await inv.listMovements(ctx, { productId: p.id, type: "TRANSFER", skip: 0, take: 10 });
    expect(mv.rows).toHaveLength(2);
    expect(new Set(mv.rows.map((r) => r.transferGroupId)).size).toBe(1);
    // transfert impossible au-delà du stock source : rien n'est modifié
    await expect(inv.manualMovement(ctx, { kind: "TRANSFER", productId: p.id, warehouseId: main.id, toWarehouseId: second.id, quantity: 50 } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(await qty(ctx, p.id)).toBe(10);
    await expect(inv.manualMovement(ctx, { kind: "TRANSFER", productId: p.id, warehouseId: main.id, toWarehouseId: main.id, quantity: 1 } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("ajustement et inventaire : écarts tracés, motif obligatoire", async () => {
    const { ctx, main } = await setup();
    const a = await inv.createProduct(ctx, prod({ name: "Prod A", openingWarehouseId: main.id, openingQuantity: 10 }));
    const b = await inv.createProduct(ctx, prod({ name: "Prod B", openingWarehouseId: main.id, openingQuantity: 5 }));
    await expect(inv.manualMovement(ctx, { kind: "ADJUSTMENT", productId: a.id, warehouseId: main.id, quantity: 8 } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await inv.manualMovement(ctx, { kind: "ADJUSTMENT", productId: a.id, warehouseId: main.id, quantity: 8, reason: "Casse" } as never);
    expect(await qty(ctx, a.id)).toBe(8);
    const res = await inv.applyCount(ctx, { warehouseId: main.id, lines: [{ productId: a.id, counted: 8 }, { productId: b.id, counted: 7 }] });
    expect(res.adjusted).toBe(1); // A inchangé → aucun mouvement
    expect(await qty(ctx, b.id)).toBe(7);
    const adj = await inv.listMovements(ctx, { productId: b.id, type: "ADJUSTMENT", skip: 0, take: 5 });
    expect(Number(adj.rows[0]!.quantity)).toBe(2);
    expect(adj.rows[0]!.reason).toBe("Inventaire physique");
  });

  it("alertes de stock minimum et valorisation", async () => {
    const { ctx, main } = await setup();
    const low = await inv.createProduct(ctx, prod({ name: "Bas", minStock: 10, costPrice: 100, openingWarehouseId: main.id, openingQuantity: 4 }));
    await inv.createProduct(ctx, prod({ name: "Haut", minStock: 10, costPrice: 200, openingWarehouseId: main.id, openingQuantity: 50 }));
    const alerts = await inv.lowStockProducts(ctx);
    expect(alerts.map((a) => a.id)).toEqual([low.id]);
    const val = await inv.stockValuation(ctx);
    expect(val.total.toNumber()).toBe(4 * 100 + 50 * 200);
  });

  it("réservation : le disponible = quantité − réservé ; libération", async () => {
    const { ctx, main } = await setup();
    const p = await inv.createProduct(ctx, prod({ openingWarehouseId: main.id, openingQuantity: 10 }));
    await ctx.tx((tx) => reserveStock(tx, ctx, { productId: p.id, warehouseId: main.id, quantity: 8 }));
    await expect(ctx.tx((tx) => reserveStock(tx, ctx, { productId: p.id, warehouseId: main.id, quantity: 3 }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const lvl = await ctx.db.stockLevel.findFirstOrThrow({ where: { productId: p.id } });
    expect(Number(lvl.reserved)).toBe(8);
    await ctx.tx((tx) => releaseReservation(tx, ctx, { productId: p.id, warehouseId: main.id, quantity: 5 }));
    expect(Number((await ctx.db.stockLevel.findFirstOrThrow({ where: { productId: p.id } })).reserved)).toBe(3);
    await ctx.tx((tx) => releaseReservation(tx, ctx, { productId: p.id, warehouseId: main.id, quantity: 99 }));
    expect(Number((await ctx.db.stockLevel.findFirstOrThrow({ where: { productId: p.id } })).reserved)).toBe(0);
  });
});

describe("entrepôts et catégories", () => {
  it("un seul entrepôt par défaut ; suppression refusée si stock ou entrepôt par défaut", async () => {
    const { ctx, main } = await setup();
    const w2 = await inv.createWarehouse(ctx, { name: "Boutique", code: "BTQ", isDefault: true });
    const all = await inv.listWarehouses(ctx);
    expect(all.filter((w) => w.isDefault).map((w) => w.id)).toEqual([w2.id]);
    await expect(inv.archiveWarehouse(ctx, w2.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const p = await inv.createProduct(ctx, prod({ openingWarehouseId: main.id, openingQuantity: 2 }));
    await expect(inv.archiveWarehouse(ctx, main.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await inv.manualMovement(ctx, { kind: "OUT", productId: p.id, warehouseId: main.id, quantity: 2 } as never);
    await inv.archiveWarehouse(ctx, main.id);
    await expect(inv.createWarehouse(ctx, { name: "Doublon", code: "BTQ", isDefault: false })).rejects.toBeTruthy();
  });

  it("catégories : suppression sans supprimer les produits", async () => {
    const { ctx } = await setup();
    const cat = await inv.createCategory(ctx, { name: "Matériaux" });
    const p = await inv.createProduct(ctx, prod({ categoryId: cat.id }));
    await inv.deleteCategory(ctx, cat.id);
    expect((await inv.getProduct(ctx, p.id)).product.categoryId).toBeNull();
  });
});

describe("ISOLATION du stock", () => {
  it("aucune lecture, mouvement, transfert ou référence croisée entre entreprises", async () => {
    const A = await setup();
    const B = await setup();
    const pB = await inv.createProduct(B.ctx, prod({ name: "Produit B", openingWarehouseId: B.main.id, openingQuantity: 9 }));
    await expect(inv.getProduct(A.ctx, pB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inv.manualMovement(A.ctx, { kind: "OUT", productId: pB.id, warehouseId: A.main.id, quantity: 1 } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const pA = await inv.createProduct(A.ctx, prod({ name: "Produit A", openingWarehouseId: A.main.id, openingQuantity: 5 }));
    await expect(inv.manualMovement(A.ctx, { kind: "IN", productId: pA.id, warehouseId: B.main.id, quantity: 1 } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inv.manualMovement(A.ctx, { kind: "TRANSFER", productId: pA.id, warehouseId: A.main.id, toWarehouseId: B.main.id, quantity: 1 } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inv.createProduct(A.ctx, prod({ name: "Prod X", categoryId: (await inv.createCategory(B.ctx, { name: "Cat B" })).id }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inv.archiveProduct(A.ctx, pB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await qty(B.ctx, pB.id)).toBe(9);
    expect((await inv.lowStockProducts(A.ctx)).map((x) => x.id)).not.toContain(pB.id);
    expect((await inv.stockValuation(A.ctx)).lines.map((l) => l.id)).toEqual([pA.id]);
  });

  it("le moteur refuse d'écrire un niveau pour une autre entreprise même en SQL (RLS)", async () => {
    const A = await setup();
    const B = await setup();
    const pB = await inv.createProduct(B.ctx, prod({ name: "PB", openingWarehouseId: B.main.id, openingQuantity: 1 }));
    await expect(tenantTransaction(A.company.id, (tx) => recordMovement(tx, A.ctx, { productId: pB.id, warehouseId: A.main.id, type: "IN", delta: 5 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
