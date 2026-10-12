import { describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { quickActionsFor } from "@/core/tenant/quick-actions";
import * as docs from "@/modules/documents/service";
import { captureExpense, captureSchema } from "@/modules/finance/capture";
import * as inv from "@/modules/inventory/service";
import { productSchema } from "@/modules/inventory/schemas";
import { ctxFor, makeCompany } from "../helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

// PNG 1×1 valide (signature + IHDR + IDAT + IEND)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function setup() {
  const co = await makeCompany("MOBILE");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const category = await ctx.db.financeCategory.findFirstOrThrow({ where: { kind: "EXPENSE" } });
  const wh = (await inv.listWarehouses(ctx))[0]!;
  const product = (over: Record<string, unknown>) => inv.createProduct(ctx, productSchema.parse({ name: "Ciment", type: "GOODS", unit: "sac", salePrice: 6500, costPrice: 5000, trackStock: false, minStock: 0, openingWarehouseId: wh.id, openingQuantity: 0, ...over }));
  const capture = (photo: File | null, over: Record<string, unknown> = {}) =>
    captureExpense(ctx, captureSchema.parse({ description: "Carburant véhicule", amount: 15000, date: new Date().toISOString().slice(0, 10), categoryId: category.id, method: "MOBILE_MONEY", ...over }), photo);
  return { ...co, ctx, category, product, capture };
}

describe("scan : recherche d'un produit par code", () => {
  it("trouve par code-barres exact, puis par référence sans tenir compte de la casse", async () => {
    const s = await setup();
    const p = await s.product({ name: "Ciment CPJ", barcode: "6111234567890" });
    expect((await inv.findProductByCode(s.ctx, "6111234567890"))?.id).toBe(p.id);
    expect((await inv.findProductByCode(s.ctx, p.sku.toLowerCase()))?.id).toBe(p.id);
    expect((await inv.findProductByCode(s.ctx, `  ${p.sku} `))?.id).toBe(p.id);
    expect(await inv.findProductByCode(s.ctx, "0000000000000")).toBeNull();
    expect(await inv.findProductByCode(s.ctx, "   ")).toBeNull();
  });

  it("ignore les produits archivés et ceux d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const pa = await A.product({ name: "Produit A", barcode: "111" });
    await B.product({ name: "Produit B", barcode: "222" });
    expect(await inv.findProductByCode(A.ctx, "222")).toBeNull();
    await inv.archiveProduct(A.ctx, pa.id);
    expect(await inv.findProductByCode(A.ctx, "111")).toBeNull();
  });
});

describe("photo d'un justificatif", () => {
  it("crée la dépense (brouillon) et rattache la photo à la dépense dans les Documents", async () => {
    const s = await setup();
    const r = await s.capture(new File([PNG], "ticket.png", { type: "image/png" }));
    expect(r.attached).toBe(true);
    expect(r.warning).toBeNull();
    const e = await s.ctx.db.expense.findFirstOrThrow({ where: { id: r.id } });
    expect(e.status).toBe("DRAFT");
    expect(Number(e.amount)).toBe(15000);
    expect(e.method).toBe("MOBILE_MONEY");
    const attached = await docs.listEntityDocuments(s.ctx, "expense", r.id);
    expect(attached).toHaveLength(1);
    expect(attached[0]!.name).toBe(`Justificatif ${r.number}`);
  });

  it("une photo inutilisable n'annule pas la dépense : elle existe, avec un avertissement", async () => {
    const s = await setup();
    const r = await s.capture(new File([Buffer.from("ceci n'est pas une image")], "x.bin", { type: "application/octet-stream" }));
    expect(r.attached).toBe(false);
    expect(r.warning).toContain("photo n'a pas pu être jointe");
    expect(await s.ctx.db.expense.count({ where: { id: r.id } })).toBe(1);
  });

  it("sans module Documents, la dépense est créée et le message l'explique", async () => {
    const s = await setup();
    await platformDb.companyModule.updateMany({ where: { companyId: s.company.id, module: { key: "documents" } }, data: { enabled: false } });
    const ctx = await ctxFor(s.owner.id, s.company.id);
    const r = await captureExpense(ctx, captureSchema.parse({ description: "Fournitures", amount: 5000, date: new Date().toISOString().slice(0, 10), categoryId: s.category.id, method: "CASH" }), new File([PNG], "t.png", { type: "image/png" }));
    expect(r.attached).toBe(false);
    expect(r.warning).toContain("Documents");
  });

  it("refuse un montant nul ou un libellé trop court, et une photo vide", async () => {
    const s = await setup();
    await expect(Promise.resolve().then(() => s.capture(null, { amount: 0 }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => s.capture(null, { description: "x" }))).rejects.toThrow();
    await expect(s.capture(new File([], "vide.jpg", { type: "image/jpeg" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("gestes rapides du bouton « + »", () => {
  const ctxOf = (modules: string[], perms: string[]) => ({ hasModule: (m: string) => modules.includes(m), can: (p: string) => perms.includes(p) });

  it("ne propose que ce que le module actif ET le droit permettent", () => {
    expect(quickActionsFor(ctxOf([], [])).map((a) => a.key)).toEqual([]);
    const keys = quickActionsFor(ctxOf(["sales", "inventory"], ["sales.quote.create", "inventory.product.read", "finance.invoice.create"])).map((a) => a.key);
    expect(keys).toEqual(["quote", "invoice", "scan"]);
    // module actif mais droit absent, et l'inverse : rien
    expect(quickActionsFor(ctxOf(["sales"], [])).length).toBe(0);
    expect(quickActionsFor(ctxOf([], ["sales.quote.create"])).length).toBe(0);
  });

  it("la photo de justificatif exige Finance et Documents", () => {
    const need = ["finance.expense.create", "documents.document.create"];
    expect(quickActionsFor(ctxOf(["finance"], need)).some((a) => a.key === "receipt")).toBe(false);
    expect(quickActionsFor(ctxOf(["finance", "documents"], need)).some((a) => a.key === "receipt")).toBe(true);
  });
});
