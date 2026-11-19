import { describe, expect, it, vi } from "vitest";
import {
  buildSalePayload, defaultFneTemplate, fneBaseUrl, fneFeatureEnabled, FneCallError, FneInputError, fneTaxCode, FNE_TEST_URL, matchFneItems, parseSaleResponse, signRefund, signSaleInvoice,
  type FneSaleInput,
} from "@/modules/sales/fne/client";
import { fneSettingsSchema } from "@/modules/sales/fne/schemas";

const sale = (over: Partial<FneSaleInput> = {}): FneSaleInput => ({
  template: "B2B", paymentMethod: "mobile-money", exemptCode: "TVAD", pointOfSale: "23", establishment: "Orange Riviera Mpouto",
  commercialMessage: "Soyez les bienvenus", footer: "", sellerName: "Ali Hassan",
  customer: { name: "KPMG COTE D'IVOIRE", taxId: "9502363N", phone: "07 09 08 07 65", email: "info@kpmg.ci" },
  lines: [
    { description: "sac de riz Dinor 5 x 5", quantity: 30, unitPrice: 20000, discountPct: 10, taxRate: 18, unit: "pcs" },
    { description: "Huile lesieur 5 litres", quantity: 20, unitPrice: 12000, discountPct: 0, taxRate: 0, unit: "bidon" },
  ],
  ...over,
});

/** Réponse de certification conforme à l'exemple de la procédure DGI (mai 2025). */
const signed = {
  ncc: "9606123E", reference: "9606123E25000000019", token: "http://54.247.95.108/fr/verification/019465c1-3f61-766c-9652-706e32dfb436", warning: false, balance_sticker: 179,
  invoice: { id: "e2b2d8da-a532-4c08-9182-f5b428ca468d", items: [{ id: "bf9cc241-9b5f-4d26-a570-aa8e682a759e", description: "sac de riz Dinor 5 x 5", quantity: 30 }, { id: "50b5c9d9-e22d-4dce-ba3c-5d2519c3418f", description: "Huile lesieur 5 litres", quantity: 20 }] },
};

describe("FNE : construction de la facture de vente", () => {
  it("produit le corps attendu par l'API #1 (codes TVA, NCC en B2B, téléphone sans espaces)", () => {
    const p = buildSalePayload(sale());
    expect(p).toMatchObject({
      invoiceType: "sale", paymentMethod: "mobile-money", template: "B2B", isRne: false, clientNcc: "9502363N", clientCompanyName: "KPMG COTE D'IVOIRE",
      clientPhone: "0709080765", clientEmail: "info@kpmg.ci", clientSellerName: "Ali Hassan", pointOfSale: "23", establishment: "Orange Riviera Mpouto",
      commercialMessage: "Soyez les bienvenus", foreignCurrency: "", foreignCurrencyRate: 0,
    });
    expect(p).not.toHaveProperty("footer");
    expect(p.items).toEqual([
      { taxes: ["TVA"], description: "sac de riz Dinor 5 x 5", quantity: 30, amount: 20000, discount: 10, measurementUnit: "pcs" },
      { taxes: ["TVAD"], description: "Huile lesieur 5 litres", quantity: 20, amount: 12000, discount: 0, measurementUnit: "bidon" },
    ]);
  });

  it("n'envoie pas de NCC hors B2B, et l'exige en B2B", () => {
    expect(buildSalePayload(sale({ template: "B2C" }))).not.toHaveProperty("clientNcc");
    expect(() => buildSalePayload(sale({ customer: { ...sale().customer, taxId: null } }))).toThrow(/NCC du client/);
  });

  it("nomme toutes les données exigées qui manquent, sans rien envoyer", () => {
    const run = () => buildSalePayload(sale({ pointOfSale: " ", customer: { name: "X", taxId: "1", phone: null, email: "" } }));
    expect(run).toThrow(FneInputError);
    expect(run).toThrow(/point de vente.*téléphone du client.*e-mail du client/);
  });

  it("refuse les lignes négatives (déduction d'acompte) et les taux de TVA inconnus de la FNE", () => {
    expect(() => buildSalePayload(sale({ lines: [{ description: "Acompte déduit", quantity: 1, unitPrice: -5000, discountPct: 0, taxRate: 18, unit: "u" }] }))).toThrow(/positifs/);
    expect(() => buildSalePayload(sale({ lines: [{ description: "Article", quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 20, unit: "u" }] }))).toThrow(/20 %/);
  });

  it("codes de TVA : 18 % → TVA, 9 % → TVAB, 0 % → exonération choisie", () => {
    expect(fneTaxCode(18, "TVAD")).toBe("TVA");
    expect(fneTaxCode(9, "TVAD")).toBe("TVAB");
    expect(fneTaxCode(0, "TVAC")).toBe("TVAC");
    expect(fneTaxCode(0, "TVAD")).toBe("TVAD");
    expect(fneTaxCode(5.5, "TVAD")).toBeNull();
  });

  it("type de client par défaut : étranger B2F, entreprise avec NCC B2B, sinon B2C", () => {
    expect(defaultFneTemplate({ type: "COMPANY", taxId: "9502363N", country: "CI" })).toBe("B2B");
    expect(defaultFneTemplate({ type: "COMPANY", taxId: null, country: null })).toBe("B2C");
    expect(defaultFneTemplate({ type: "INDIVIDUAL", taxId: "123", country: "CI" })).toBe("B2C");
    expect(defaultFneTemplate({ type: "COMPANY", taxId: "FR123", country: "FR" })).toBe("B2F");
  });
});

describe("FNE : interrupteur de la plateforme", () => {
  it("fermée par défaut (autorisation de la DGI en attente) ; ouverte seulement avec FNE_ENABLED=true", () => {
    expect(fneFeatureEnabled({})).toBe(false);
    expect(fneFeatureEnabled({ FNE_ENABLED: "false" })).toBe(false);
    expect(fneFeatureEnabled({ FNE_ENABLED: "1" })).toBe(false);
    expect(fneFeatureEnabled({ FNE_ENABLED: "true" })).toBe(true);
  });
});

describe("FNE : environnement", () => {
  it("test par défaut sur l'URL publique de la DGI ; production uniquement si FNE_PROD_URL est valide", () => {
    expect(fneBaseUrl("test", {})).toBe(FNE_TEST_URL);
    expect(fneBaseUrl("production", {})).toBeNull();
    expect(fneBaseUrl("production", { FNE_PROD_URL: "https://fne.dgi.gouv.ci/ws/" })).toBe("https://fne.dgi.gouv.ci/ws");
    expect(fneBaseUrl("production", { FNE_PROD_URL: "ftp://x" })).toBeNull();
    expect(fneBaseUrl("production", { FNE_PROD_URL: "pas une url" })).toBeNull();
  });

  it("la clé API ne peut contenir ni espace ni caractère accentué", () => {
    const base = { enabled: true, environment: "test", pointOfSale: "1", establishment: "Siège", autoCertify: true, exemptTaxCode: "TVAD" };
    expect(fneSettingsSchema.safeParse({ ...base, apiKey: "kAF01gEM40r1Uz5WLJn5lxAnGMwVjCME" }).success).toBe(true);
    expect(fneSettingsSchema.safeParse({ ...base, apiKey: "clé avec espace" }).success).toBe(false);
  });
});

describe("FNE : appels à la plateforme", () => {
  const conn = (impl: typeof fetch) => ({ baseUrl: "http://fne.test/ws", apiKey: "secret-key", fetchImpl: impl });

  it("certifie : en-têtes, chemin, et lecture du numéro, du lien de vérification et du solde de stickers", async () => {
    const f = vi.fn(async () => Response.json(signed));
    const cert = await signSaleInvoice(conn(f as unknown as typeof fetch), { x: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://fne.test/ws/external/invoices/sign");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key", "Content-Type": "application/json", Accept: "application/json" });
    expect(cert).toMatchObject({ reference: "9606123E25000000019", verifyUrl: signed.token, fneId: signed.invoice.id, stickerBalance: 179, stickerWarning: false });
    expect(cert.items.map((i) => i.id)).toEqual(signed.invoice.items.map((i) => i.id));
  });

  it("un refus (400, 401) est un échec certain ; une panne (réseau, 5xx, réponse illisible) est une issue incertaine", async () => {
    const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    await expect(signSaleInvoice(conn(reply(400, { message: "Point of sale is not valid", error: "bad_request", statusCode: 400 })), {})).rejects.toMatchObject({ outcome: "rejected", message: expect.stringContaining("Point of sale is not valid") });
    await expect(signSaleInvoice(conn(reply(401, { message: "Invalid API Key" })), {})).rejects.toMatchObject({ outcome: "rejected", message: expect.stringContaining("Clé API FNE refusée") });
    await expect(signSaleInvoice(conn(reply(500, { message: "Internal Server Error" })), {})).rejects.toMatchObject({ outcome: "unknown" });
    await expect(signSaleInvoice(conn(vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch), {})).rejects.toMatchObject({ outcome: "unknown" });
    await expect(signSaleInvoice(conn(reply(200, { reference: "X" })), {})).rejects.toBeInstanceOf(FneCallError);
  });

  it("avoir : appelle /invoices/{id}/refund avec les articles FNE et les quantités", async () => {
    const f = vi.fn(async () => Response.json({ ncc: "9606123E", reference: "A9606123E2500000006", token: "http://54.247.95.108/fr/verification/019465ca", warning: true, balance_sticker: 3 }, { status: 201 }));
    const cert = await signRefund(conn(f as unknown as typeof fetch), signed.invoice.id, [{ id: "bf9cc241", quantity: 20 }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://fne.test/ws/external/invoices/${signed.invoice.id}/refund`);
    expect(JSON.parse(init.body as string)).toEqual({ items: [{ id: "bf9cc241", quantity: 20 }] });
    expect(cert).toMatchObject({ reference: "A9606123E2500000006", stickerWarning: true, stickerBalance: 3 });
    await expect(signRefund(conn(f as unknown as typeof fetch), "../../x", [{ id: "a", quantity: 1 }])).rejects.toBeInstanceOf(FneInputError);
  });

  it("apparie les lignes aux articles FNE : par position, sinon par désignation et quantité", () => {
    const lines = [{ id: "L1", description: "sac de riz Dinor 5 x 5", quantity: 30 }, { id: "L2", description: "Huile lesieur 5 litres", quantity: 20 }];
    const items = parseSaleResponse(signed).items;
    expect(matchFneItems(lines, items)).toEqual([{ lineId: "L1", fneItemId: items[0]!.id }, { lineId: "L2", fneItemId: items[1]!.id }]);
    expect(matchFneItems([...lines, { id: "L3", description: "Autre", quantity: 1 }], [items[1]!, items[0]!])).toEqual([{ lineId: "L1", fneItemId: items[0]!.id }, { lineId: "L2", fneItemId: items[1]!.id }]);
  });
});
