import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importFneRegistry, loadFneRevenue, parseFneExport, summarizeFneRegistry } from "@/modules/sales/fne/registry";
import { exportOf } from "../fne-export";
import { ctxFor, makeCompany, uid } from "../helpers";

describe("registre FNE : lecture de l'export", () => {
  it("classe facture / avoir / proforma, garde les avoirs en négatif, ignore ce qui n'est pas du chiffre d'affaires", async () => {
    const p = await parseFneExport(await exportOf([
      { ref: "F1", ht: 1000, vat: 180, ttc: 1180 },
      { ref: "A1", sub: "refund", initial: "F1", ht: -400, vat: -72, ttc: -472 },
      { ref: "A2", sub: "refund", ht: 100, vat: 18, ttc: 118 }, // un avoir positif dans le fichier est ramené en négatif
      { ref: "P1", sub: "proforma", token: "T-SHARED", ht: 5000, vat: 900, ttc: 5900 },
      { ref: "B1", type: "purchase", ht: 300, vat: 0, ttc: 300 }, // bordereau d'achat : pas du CA
      { ref: "F1", ht: 1, vat: 1, ttc: 2 }, // même numéro FNE deux fois dans le fichier
      { ref: "X1", date: "pas une date" },
      { ref: "X2", ttc: "abc" },
    ]));
    expect(p.total).toBe(8);
    expect(p.rows.map((r) => `${r.reference}:${r.kind}`)).toEqual(["F1:INVOICE", "A1:REFUND", "A2:REFUND", "P1:PROFORMA"]);
    expect(p.rows.find((r) => r.reference === "A2")).toMatchObject({ totalHt: "-100.00", totalVat: "-18.00", totalTtc: "-118.00" });
    expect(p.rows.find((r) => r.reference === "A1")?.initialReference).toBe("F1");
    expect(p.skipped).toBe(1);
    expect(p.duplicatesInFile).toBe(1);
    expect(p.invalidCount).toBe(2);
    expect(p.invalid.map((i) => i.reason)).toEqual([expect.stringContaining("date illisible"), expect.stringContaining("montant illisible")]);
  });

  it("garde un avoir exporté sans numéro FNE (facture d'origine connue), sous une clé stable ; refuse un document sans aucun numéro", async () => {
    const docs = [
      { ref: "", sub: "refund", initial: "F9", date: "2026-02-17T15:08:11.414Z", ht: -3220000, vat: -579600, ttc: -3799600 },
      { ref: "", sub: "normal" }, // ni numéro ni facture d'origine : illisible
    ];
    const p = await parseFneExport(await exportOf(docs));
    expect(p.rows).toHaveLength(1);
    expect(p.withoutNumber).toBe(1);
    expect(p.rows[0]).toMatchObject({ kind: "REFUND", initialReference: "F9", totalTtc: "-3799600.00" });
    expect(p.rows[0]!.reference).toBe(`SANS-NUMERO-F9-${new Date("2026-02-17T15:08:11.414Z").getTime()}`);
    expect(p.invalidCount).toBe(1);
    // la clé est la même à chaque lecture : ré-importer ne double pas l'avoir
    expect((await parseFneExport(await exportOf(docs))).rows[0]!.reference).toBe(p.rows[0]!.reference);
  });

  it("refuse un fichier qui n'est pas un export FNE, avec un message clair", async () => {
    await expect(parseFneExport(Buffer.from("a;b;c\n1;2;3"))).rejects.toMatchObject({ message: expect.stringContaining("n'est pas un classeur Excel") });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRows([["Nom", "Montant"], ["a", 1]]);
    const other = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseFneExport(other)).rejects.toMatchObject({ message: expect.stringMatching(/colonnes manquantes \(Référence, Sous-type de facture, Date/) });
  });

  it("le chiffre d'affaires = factures − avoirs, sans les proformas ; ventilation par mois, client et mode de paiement", () => {
    const e = (kind: "INVOICE" | "REFUND" | "PROFORMA", date: string, ht: number, ttc: number, extra: Partial<{ customerName: string; customerNcc: string | null; paymentMethod: string | null }> = {}) =>
      ({ kind, issuedAt: new Date(date), totalHt: ht, totalVat: ttc - ht, totalTtc: ttc, customerName: "A", customerNcc: "N1", paymentMethod: "check", currency: "XOF", ...extra });
    const s = summarizeFneRegistry([
      e("INVOICE", "2026-01-05T00:00:00Z", 1000, 1180),
      e("INVOICE", "2026-01-20T00:00:00Z", 2000, 2360, { customerName: "B", customerNcc: "N2", paymentMethod: "transfer" }),
      e("REFUND", "2026-02-02T00:00:00Z", -500, -590),
      e("PROFORMA", "2026-02-03T00:00:00Z", 9000, 10620),
    ]);
    expect(s).toMatchObject({ ht: 2500, ttc: 2950, invoices: 2, refunds: 1, refundsTtc: -590, proformas: 1, proformasTtc: 10620 });
    expect(s.vat).toBeCloseTo(450, 5);
    expect(s.months.map((m) => [m.month, m.ht, m.invoices, m.refunds])).toEqual([["2026-01", 3000, 2, 0], ["2026-02", -500, 0, 1]]);
    expect(s.customers.map((c) => [c.name, c.ht])).toEqual([["B", 2000], ["A", 500]]);
    expect(s.methods.map((m) => m.method)).toEqual(["transfer", "check"]);
  });
});

describe("registre FNE : import dans l'entreprise", () => {
  it("ajoute les documents, ne compte jamais deux fois à la ré-importation, et suit le chiffre d'affaires de la période", async () => {
    const { company, owner } = await makeCompany("FNEREG", "business");
    const ctx = await ctxFor(owner.id, company.id);
    const r1 = uid(), r2 = uid(), r3 = uid();
    const first = await exportOf([
      { ref: r1, date: "2026-01-10T09:00:00Z", ht: 1000, vat: 180, ttc: 1180 },
      { ref: r2, sub: "refund", initial: r1, date: "2026-02-10T09:00:00Z", ht: -200, vat: -36, ttc: -236 },
      { ref: r3, sub: "proforma", date: "2026-02-11T09:00:00Z", ht: 7000, vat: 0, ttc: 7000 },
    ]);
    const a = await importFneRegistry(ctx, { name: "export1.xlsx" }, first);
    expect(a).toMatchObject({ total: 3, added: { invoices: 1, refunds: 1, proformas: 1 }, alreadyKnown: 0 });

    // même fichier : rien de nouveau
    const again = await importFneRegistry(ctx, { name: "export1.xlsx" }, first);
    expect(again).toMatchObject({ added: { invoices: 0, refunds: 0, proformas: 0 }, alreadyKnown: 3 });
    expect(await ctx.db.fneRegistryEntry.count()).toBe(3);

    // export plus récent : seul le nouveau document est ajouté
    const r4 = uid();
    const later = await exportOf([
      { ref: r1, date: "2026-01-10T09:00:00Z", ht: 1000, vat: 180, ttc: 1180 },
      { ref: r4, date: "2026-03-01T09:00:00Z", ht: 500, vat: 90, ttc: 590 },
    ]);
    expect(await importFneRegistry(ctx, { name: "export2.xlsx" }, later)).toMatchObject({ added: { invoices: 1 }, alreadyKnown: 1 });

    const all = await loadFneRevenue(ctx, {});
    expect(all).toMatchObject({ ht: 1300, ttc: 1534, invoices: 2, refunds: 1, proformas: 1 });
    const q1 = await loadFneRevenue(ctx, { gte: new Date("2026-02-01T00:00:00Z"), lt: new Date("2026-03-01T00:00:00Z") });
    expect(q1).toMatchObject({ ht: -200, invoices: 0, refunds: 1 });
  });

  it("chaque entreprise a son registre : même numéro FNE possible ailleurs, jamais de fuite", async () => {
    const A = await makeCompany("FNEA", "business");
    const B = await makeCompany("FNEB", "business");
    const ctxA = await ctxFor(A.owner.id, A.company.id);
    const ctxB = await ctxFor(B.owner.id, B.company.id);
    const shared = uid();
    await importFneRegistry(ctxA, { name: "a.xlsx" }, await exportOf([{ ref: shared, ht: 100, vat: 18, ttc: 118 }]));
    expect(await ctxB.db.fneRegistryEntry.count()).toBe(0);
    await importFneRegistry(ctxB, { name: "b.xlsx" }, await exportOf([{ ref: shared, ht: 900, vat: 162, ttc: 1062 }]));
    expect((await loadFneRevenue(ctxA, {})).ht).toBe(100);
    expect((await loadFneRevenue(ctxB, {})).ht).toBe(900);
  });
});
