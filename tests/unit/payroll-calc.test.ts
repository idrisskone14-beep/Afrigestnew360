import { describe, expect, it } from "vitest";
import { d } from "@/core/money";
import { bracketTax, computePayslip, validateBrackets, type ItemDef } from "@/modules/payroll/calc";

const item = (over: Partial<ItemDef> & Pick<ItemDef, "code" | "type" | "mode">): ItemDef => ({
  name: over.code, category: "OTHER", base: "GROSS", value: d(0), ceiling: null, brackets: null, taxable: true, deductibleForTax: false, sortOrder: 100, ...over,
});

describe("barème progressif", () => {
  const b = [{ upTo: 100000, rate: 0 }, { upTo: 300000, rate: 10 }, { upTo: null, rate: 20 }];
  it("applique chaque taux à sa seule tranche", () => {
    expect(bracketTax(d(50000), b).toNumber()).toBe(0);
    expect(bracketTax(d(100000), b).toNumber()).toBe(0);
    expect(bracketTax(d(200000), b).toNumber()).toBe(10000); // 100 000 × 10 %
    expect(bracketTax(d(300000), b).toNumber()).toBe(20000);
    expect(bracketTax(d(500000), b).toNumber()).toBe(60000); // 20 000 + 200 000 × 20 %
    expect(bracketTax(d(0), b).toNumber()).toBe(0);
  });
  it("valide la table de tranches", () => {
    expect(validateBrackets(b)).toBeNull();
    expect(validateBrackets([])).not.toBeNull();
    expect(validateBrackets([{ upTo: 100, rate: 5 }, { upTo: 50, rate: 5 }])).toContain("dépasser");
    expect(validateBrackets([{ upTo: null, rate: 5 }, { upTo: 50, rate: 5 }])).toContain("dernière");
    expect(validateBrackets([{ upTo: 100, rate: 120 }])).toContain("taux");
  });
});

describe("calcul d'un bulletin", () => {
  const retraite = item({ code: "RET", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", base: "GROSS", value: d(6), ceiling: d(400000), deductibleForTax: true, sortOrder: 10 });
  const impot = item({ code: "IMP", type: "DEDUCTION", category: "TAX", mode: "BRACKETS", base: "TAXABLE", brackets: [{ upTo: 100000, rate: 0 }, { upTo: null, rate: 10 }], sortOrder: 20 });
  const patronal = item({ code: "PAT", type: "EMPLOYER", category: "SOCIAL", mode: "RATE", base: "GROSS", value: d(8) });
  const transport = item({ code: "TRA", type: "EARNING", mode: "FIXED", value: d(20000), taxable: false });

  it("brut, retenues avec plafond, impôt sur l'assiette déduite des cotisations, net et coût employeur", () => {
    const r = computePayslip({ baseSalary: d(500000), prorata: d(1), items: [impot, retraite, patronal, transport], extras: [], currency: "XOF" });
    expect(r.baseAmount.toNumber()).toBe(500000);
    expect(r.gross.toNumber()).toBe(520000); // 500 000 + prime de transport 20 000
    expect(r.taxableGross.toNumber()).toBe(500000); // la prime de transport n'est pas imposable
    // retraite : 6 % de min(520 000 ; plafond 400 000) = 24 000 (déductible)
    const ret = r.lines.find((l) => l.code === "RET")!;
    expect(ret.amount.toNumber()).toBe(24000);
    expect(ret.base!.toNumber()).toBe(400000);
    // impôt : assiette = 500 000 − 24 000 = 476 000 ; (476 000 − 100 000) × 10 % = 37 600 ; calculé APRÈS la retraite grâce à l'ordre de tri
    expect(r.lines.find((l) => l.code === "IMP")!.amount.toNumber()).toBe(37600);
    expect(r.deductions.toNumber()).toBe(61600);
    expect(r.net.toNumber()).toBe(520000 - 61600);
    expect(r.employerCharges.toNumber()).toBe(41600); // 8 % de 520 000
    expect(r.employerCost.toNumber()).toBe(561600);
    // identité comptable : brut = net + retenues
    expect(r.gross.toNumber()).toBe(r.net.plus(r.deductions).toNumber());
  });

  it("prorata (entrée en cours de mois, congé non payé) appliqué au salaire de base et aux gains en pourcentage", () => {
    const prime = item({ code: "ANC", type: "EARNING", mode: "RATE", value: d(10) });
    const r = computePayslip({ baseSalary: d(300000), prorata: d(0.5), items: [prime], extras: [], currency: "XOF" });
    expect(r.baseAmount.toNumber()).toBe(150000);
    expect(r.lines.find((l) => l.code === "ANC")!.amount.toNumber()).toBe(15000); // 10 % du base proratisé
    expect(r.gross.toNumber()).toBe(165000);
  });

  it("primes et retenues propres au salarié ; arrondi à l'unité en FCFA, au centime en euros", () => {
    const r = computePayslip({
      baseSalary: d(333333), prorata: d(1), items: [item({ code: "RET", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", value: d(3.3333) })],
      extras: [{ name: "Prime de panier", type: "EARNING", category: "OTHER", amount: d(10000), taxable: true }, { name: "Remboursement avance", type: "DEDUCTION", category: "OTHER", amount: d(25000), taxable: false }], currency: "XOF",
    });
    expect(r.gross.toNumber()).toBe(343333);
    expect(Number.isInteger(r.lines.find((l) => l.code === "RET")!.amount.toNumber())).toBe(true);
    expect(r.lines.find((l) => l.code === "RETENUE")).toMatchObject({ label: "Remboursement avance", category: "OTHER" });
    const eur = computePayslip({ baseSalary: d(2500.55), prorata: d(1), items: [item({ code: "RET", type: "DEDUCTION", mode: "RATE", value: d(7.5) })], extras: [], currency: "EUR" });
    expect(eur.lines.find((l) => l.code === "RET")!.amount.toNumber()).toBe(187.54); // 2 500,55 × 7,5 % = 187,54125
  });

  it("une rubrique nulle n'apparaît pas ; sans rubrique, net = brut = base", () => {
    const r = computePayslip({ baseSalary: d(100000), prorata: d(1), items: [], extras: [], currency: "XOF" });
    expect(r.lines).toHaveLength(1);
    expect(r.net.toNumber()).toBe(100000);
    expect(r.employerCost.toNumber()).toBe(100000);
    const z = computePayslip({ baseSalary: d(100000), prorata: d(1), items: [item({ code: "X", type: "DEDUCTION", mode: "RATE", value: d(0) })], extras: [], currency: "XOF" });
    expect(z.lines).toHaveLength(1);
  });
});
