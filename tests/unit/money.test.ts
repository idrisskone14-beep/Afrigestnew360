import { describe, expect, it } from "vitest";
import { computeLine, computeTotals, currencyDecimals, d, roundMoney, splitInstallments } from "@/core/money";
import { formatNumber } from "@/core/numbering";

describe("montants (Decimal, jamais de flottants)", () => {
  it("0,1 + 0,2 = 0,3 exactement", () => {
    expect(d("0.1").plus(d("0.2")).toString()).toBe("0.3");
  });

  it("FCFA : arrondi à l'unité ; euro : 2 décimales", () => {
    expect(currencyDecimals("XOF")).toBe(0);
    expect(currencyDecimals("EUR")).toBe(2);
    expect(roundMoney("1234.5", "XOF").toString()).toBe("1235");
    expect(roundMoney("1234.4", "XOF").toString()).toBe("1234");
    expect(roundMoney("10.005", "EUR").toString()).toBe("10.01");
  });

  it("ligne : quantité × prix, remise %, taxe %", () => {
    const l = computeLine({ quantity: 3, unitPrice: 10_000, discountPct: 10, taxRate: 18 }, "XOF");
    expect(l.gross.toString()).toBe("30000");
    expect(l.discount.toString()).toBe("3000");
    expect(l.net.toString()).toBe("27000");
    expect(l.tax.toString()).toBe("4860");
    expect(l.total.toString()).toBe("31860");
  });

  it("quantités décimales et arrondi par ligne", () => {
    const l = computeLine({ quantity: "2.5", unitPrice: "1999", taxRate: 18 }, "XOF");
    expect(l.gross.toString()).toBe("4998"); // 4997.5 arrondi
    expect(l.tax.toString()).toBe("900");
  });

  it("le total est la somme des lignes arrondies (aucun écart d'un centime)", () => {
    const lines = Array.from({ length: 7 }, () => ({ quantity: 1, unitPrice: "33.33", taxRate: 19.25 }));
    const t = computeTotals(lines, "EUR");
    const single = computeLine(lines[0]!, "EUR");
    expect(t.total.toString()).toBe(single.total.mul(7).toString());
    expect(t.netTotal.plus(t.taxTotal).toString()).toBe(t.total.toString());
  });

  it("totaux vides et lignes sans taxe", () => {
    expect(computeTotals([], "XOF").total.toString()).toBe("0");
    expect(computeLine({ quantity: 2, unitPrice: 500 }, "XOF").total.toString()).toBe("1000");
  });

  it("échéancier : la somme est exacte, le dernier terme absorbe l'arrondi", () => {
    const parts = splitInstallments(100_000, 3, "XOF");
    expect(parts.map((p) => p.toString())).toEqual(["33333", "33333", "33334"]);
    expect(parts.reduce((a, b) => a.plus(b)).toString()).toBe("100000");
    const eur = splitInstallments("100.00", 3, "EUR");
    expect(eur.reduce((a, b) => a.plus(b)).toString()).toBe("100");
  });
});

describe("format de numérotation", () => {
  it("préfixe-année-séquence avec remplissage", () => {
    expect(formatNumber({ prefix: "DEV", padding: 5, withYear: true }, 1, 2026)).toBe("DEV-2026-00001");
    expect(formatNumber({ prefix: "FAC", padding: 5, withYear: true }, 123, 2026)).toBe("FAC-2026-00123");
  });
  it("sans année et avec un autre remplissage", () => {
    expect(formatNumber({ prefix: "CLI", padding: 4, withYear: false }, 7, 2026)).toBe("CLI-0007");
    expect(formatNumber({ prefix: "X", padding: 2, withYear: false }, 12345, 2026)).toBe("X-12345");
  });
});
