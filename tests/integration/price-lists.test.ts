import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as crm from "@/modules/crm/service";
import { customerSchema, updateCustomerSchema } from "@/modules/crm/schemas";
import * as inv from "@/modules/inventory/service";
import { productSchema } from "@/modules/inventory/schemas";
import { createPriceList, deletePriceList, getPriceList, listPriceLists, priceListItemsSchema, priceListSchema, setPriceListItems, updatePriceList, updatePriceListSchema } from "@/modules/sales/price-lists";
import { loadSalesEditorData } from "@/modules/sales/ui/sales-editor-data";
import { ctxFor, makeCompany } from "../helpers";

async function setup() {
  const co = await makeCompany("TARIFS");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const wh = (await inv.listWarehouses(ctx))[0]!;
  const product = (name: string, salePrice: number) => inv.createProduct(ctx, productSchema.parse({ name, type: "GOODS", unit: "sac", salePrice, costPrice: 1000, trackStock: false, minStock: 0, openingWarehouseId: wh.id, openingQuantity: 0 }));
  const customer = (name: string, extra: Record<string, unknown> = {}) => crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name, paymentTermsDays: 30, ...extra }));
  const list = (name = "Grossistes") => createPriceList(ctx, priceListSchema.parse({ name }));
  return { ...co, ctx, product, customer, list };
}

describe("listes de prix", () => {
  it("crée, renomme, liste et refuse un nom en double", async () => {
    const s = await setup();
    const l = await s.list("Grossistes");
    await expect(s.list("grossistes")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const other = await s.list("Revendeurs");
    await expect(updatePriceList(s.ctx, updatePriceListSchema.parse({ id: other.id, name: "GROSSISTES" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await updatePriceList(s.ctx, updatePriceListSchema.parse({ id: l.id, name: "Grossistes 2026", description: "Remise volume", isActive: true }));
    expect((await listPriceLists(s.ctx)).map((x) => x.name)).toEqual(["Grossistes 2026", "Revendeurs"]);
  });

  it("remplace les prix de la liste, arrondis à la devise, sans doublon de produit", async () => {
    const s = await setup();
    const l = await s.list();
    const a = await s.product("Ciment", 6500);
    const b = await s.product("Fer", 7200);
    await setPriceListItems(s.ctx, priceListItemsSchema.parse({ id: l.id, items: [{ productId: a.id, price: 6100.4 }, { productId: b.id, price: 6900 }] }));
    let full = await getPriceList(s.ctx, l.id);
    expect(full.items.map((i) => [i.product.name, Number(i.price)])).toEqual([["Ciment", 6100], ["Fer", 6900]]);
    await setPriceListItems(s.ctx, priceListItemsSchema.parse({ id: l.id, items: [{ productId: b.id, price: 6800 }] }));
    full = await getPriceList(s.ctx, l.id);
    expect(full.items).toHaveLength(1);
    await expect(setPriceListItems(s.ctx, priceListItemsSchema.parse({ id: l.id, items: [{ productId: b.id, price: 1 }, { productId: b.id, price: 2 }] }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("refuse le produit ou la liste d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const la = await A.list();
    const pb = await B.product("Produit B", 100);
    await expect(setPriceListItems(A.ctx, priceListItemsSchema.parse({ id: la.id, items: [{ productId: pb.id, price: 90 }] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const lb = await B.list("Liste B");
    await expect(getPriceList(A.ctx, lb.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(A.customer("Client A", { priceListId: lb.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("rattache la liste à un client ; la saisie des documents reçoit ses prix ; la suppression remet au prix standard", async () => {
    const s = await setup();
    const l = await s.list();
    const p = await s.product("Ciment", 6500);
    await setPriceListItems(s.ctx, priceListItemsSchema.parse({ id: l.id, items: [{ productId: p.id, price: 6000 }] }));
    const c = await s.customer("Quincaillerie", { priceListId: l.id });
    const plain = await s.customer("Client standard");
    expect(c.priceListId).toBe(l.id);

    const data = await loadSalesEditorData(s.ctx);
    const forC = data.customers.find((x) => x.id === c.id)!;
    expect(forC.priceListName).toBe("Grossistes");
    expect(forC.prices).toEqual({ [p.id]: 6000 });
    expect(data.customers.find((x) => x.id === plain.id)!.prices).toEqual({});

    // liste désactivée : plus de prix proposés, et plus rattachable
    await updatePriceList(s.ctx, updatePriceListSchema.parse({ id: l.id, name: "Grossistes", isActive: false }));
    expect((await loadSalesEditorData(s.ctx)).customers.find((x) => x.id === c.id)!.prices).toEqual({});
    await expect(s.customer("Autre", { priceListId: l.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await updatePriceList(s.ctx, updatePriceListSchema.parse({ id: l.id, name: "Grossistes", isActive: true }));

    // changer d'autres champs du client ne revalide pas une liste inchangée ; la retirer remet au prix standard
    await crm.updateCustomer(s.ctx, updateCustomerSchema.parse({ id: c.id, type: "COMPANY", name: "Quincaillerie", paymentTermsDays: 45, priceListId: l.id, isActive: true }));
    expect((await crm.getCustomer(s.ctx, c.id)).priceListId).toBe(l.id);
    await deletePriceList(s.ctx, l.id);
    expect((await crm.getCustomer(s.ctx, c.id)).priceListId).toBeNull();
  });
});
