import { describe, expect, it } from "vitest";
import { renderBusinessDocument, sentenceCase, taxBreakdown, type BusinessDocument, type PdfLine } from "@/core/pdf/business-document";

const line = (over: Partial<PdfLine> = {}): PdfLine => ({ description: "Prestation", quantity: 1, unit: "", unitPrice: 1000, discountPct: 0, taxRate: 18, total: 1180, ...over });

describe("document commercial (PDF)", () => {
  it("le titre s'affiche en minuscules avec une majuscule initiale", () => {
    expect(sentenceCase("DEVIS")).toBe("Devis");
    expect(sentenceCase("FACTURE PROFORMA")).toBe("Facture proforma");
    expect(sentenceCase("Bon de commande")).toBe("Bon de commande");
  });

  it("détail de TVA : regroupe par taux, avec les montants enregistrés par ligne", () => {
    const rows = taxBreakdown([
      line({ net: 1000, tax: 180 }),
      line({ net: 500, tax: 90 }),
      line({ taxRate: 0, net: 200, tax: 0 }),
      line({ taxRate: 10, net: 300, tax: 30 }),
    ]);
    expect(rows).toEqual([
      { rate: 0, base: 200, tax: 0 },
      { rate: 10, base: 300, tax: 30 },
      { rate: 18, base: 1500, tax: 270 },
    ]);
  });

  it("détail de TVA : repli sur le calcul quand les montants enregistrés manquent (remise comprise)", () => {
    const [r] = taxBreakdown([line({ quantity: 2, unitPrice: 1000, discountPct: 10, taxRate: 18 })]);
    expect(r?.base).toBeCloseTo(1800, 6);
    expect(r?.tax).toBeCloseTo(324, 6);
  });

  const base: BusinessDocument = {
    title: "Devis", number: "DEV-2026-00001", currency: "XOF",
    issuer: { name: "Ets Test", lines: ["Abidjan"], legal: ["Ets Test SARL"], footer: "ETS TEST - Société à Responsabilité Limitée (SARL) au capital de 20 000 000 FCFA - NCC: 1507399G - Adresse: Yopougon, Cité Bel Air Route N'Dotré" },
    recipient: { name: "Client Test", lines: ["Cocody"] },
    dates: [{ label: "Date d'émission", value: new Date("2026-10-11T12:00:00") }, { label: "Valable jusqu'au", value: null }],
    lines: [line({ net: 1000, tax: 180 })],
    totals: [{ label: "Total HT", value: 1000 }, { label: "TVA", value: 180 }, { label: "Total TTC", value: 1180 }, { label: "Net à payer", value: 1180, bold: true }],
    notes: "Note", terms: "Paiement à 30 jours", signatureLabel: "Bon pour accord",
  };

  const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

  it("génère un PDF valide pour un devis complet, pied de page compris, sans page supplémentaire", async () => {
    const pdf = await renderBusinessDocument(base);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    expect(pageCount(pdf)).toBe(1);
    // un pied de page très long (texte personnalisé) ne doit pas déborder sur une page de plus
    const wordy = await renderBusinessDocument({ ...base, issuer: { ...base.issuer, footer: "Mention légale très longue. ".repeat(18) } });
    expect(pageCount(wordy)).toBe(1);
  });

  it("génère un PDF valide pour un bon de livraison (sans prix) et pour un long document sur plusieurs pages", async () => {
    const delivery = await renderBusinessDocument({ ...base, title: "Bon de livraison", hidePrices: true, totals: undefined, signatureLabel: undefined });
    expect(delivery.subarray(0, 5).toString()).toBe("%PDF-");
    const many = Array.from({ length: 60 }, (_, i) => line({ description: `Article ${i + 1} — désignation un peu longue pour provoquer un retour à la ligne dans la colonne`, net: 1000, tax: 180 }));
    const long = await renderBusinessDocument({ ...base, lines: many });
    expect(long.subarray(0, 5).toString()).toBe("%PDF-");
    expect(long.length).toBeGreaterThan(delivery.length);
    expect((long.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
