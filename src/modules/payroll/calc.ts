import { d, roundMoney, type Decimal } from "@/core/money";

/**
 * Moteur de calcul d'un bulletin — fonction pure (aucun accès base), donc testable et rejouable.
 * Il applique des rubriques PARAMÉTRÉES : aucun taux ni barème légal n'est codé ici.
 *
 * Ordre : salaire de base (au prorata) → gains → brut → retenues salariales (dans l'ordre de tri des rubriques,
 * l'assiette « imposable » tenant compte des retenues déductibles déjà calculées : placez l'impôt APRÈS les cotisations)
 * → net à payer ; charges patronales calculées à part (coût employeur = brut + charges).
 */
export type ItemType = "EARNING" | "DEDUCTION" | "EMPLOYER";
export type ItemCategory = "SOCIAL" | "TAX" | "OTHER";
export type CalcMode = "FIXED" | "RATE" | "BRACKETS";
export type CalcBase = "BASE" | "GROSS" | "TAXABLE";

export interface Bracket { upTo: number | null; rate: number }

export interface ItemDef {
  code: string; name: string; type: ItemType; category: ItemCategory; mode: CalcMode; base: CalcBase;
  value: Decimal; ceiling: Decimal | null; brackets: Bracket[] | null; taxable: boolean; deductibleForTax: boolean; sortOrder: number;
}
/** Prime ou retenue propre au salarié (montant fixe). */
export interface ExtraItem { name: string; type: "EARNING" | "DEDUCTION"; category: ItemCategory; amount: Decimal; taxable: boolean }

export interface PayLine { code: string; label: string; type: ItemType; category: ItemCategory; base: Decimal | null; rate: Decimal | null; amount: Decimal }

export interface PayslipCalc {
  baseAmount: Decimal; gross: Decimal; taxableGross: Decimal; deductions: Decimal; net: Decimal; employerCharges: Decimal; employerCost: Decimal;
  lines: PayLine[];
}

/** Valide une table de tranches : croissantes, taux 0-100, seule la dernière peut être ouverte (upTo = null). */
export function validateBrackets(b: Bracket[]): string | null {
  if (b.length === 0) return "Au moins une tranche est requise.";
  let prev = 0;
  for (let i = 0; i < b.length; i++) {
    const t = b[i]!;
    if (!(t.rate >= 0 && t.rate <= 100)) return `Tranche ${i + 1} : le taux doit être compris entre 0 et 100 %.`;
    if (t.upTo === null) { if (i !== b.length - 1) return "Seule la dernière tranche peut être sans plafond."; continue; }
    if (!(t.upTo > prev)) return `Tranche ${i + 1} : le plafond doit dépasser celui de la tranche précédente.`;
    prev = t.upTo;
  }
  return null;
}

/** Impôt progressif par tranches marginales sur l'assiette. */
export function bracketTax(base: Decimal, brackets: Bracket[]): Decimal {
  let tax = d(0), lower = d(0);
  for (const t of brackets) {
    const upper = t.upTo === null ? null : d(t.upTo);
    const top = upper === null || base.lt(upper) ? base : upper;
    const slice = top.minus(lower);
    if (slice.gt(0)) tax = tax.plus(slice.mul(t.rate).div(100));
    if (upper === null || base.lte(upper)) break;
    lower = upper;
  }
  return tax;
}

export function computePayslip(input: { baseSalary: Decimal; prorata: Decimal; items: ItemDef[]; extras: ExtraItem[]; currency: string }): PayslipCalc {
  const cur = input.currency;
  const r = (v: Decimal) => roundMoney(v, cur);
  const baseAmount = r(input.baseSalary.mul(input.prorata));
  const items = [...input.items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const lines: PayLine[] = [{ code: "BASE", label: "Salaire de base", type: "EARNING", category: "OTHER", base: null, rate: null, amount: baseAmount }];
  let gross = baseAmount, taxableGross = baseAmount;

  // Gains : montant fixe, ou pourcentage du salaire de base (au prorata)
  for (const it of items.filter((i) => i.type === "EARNING")) {
    const amount = it.mode === "RATE" ? r(baseAmount.mul(it.value).div(100)) : r(it.value);
    if (amount.isZero()) continue;
    lines.push({ code: it.code, label: it.name, type: "EARNING", category: "OTHER", base: it.mode === "RATE" ? baseAmount : null, rate: it.mode === "RATE" ? it.value : null, amount });
    gross = gross.plus(amount);
    if (it.taxable) taxableGross = taxableGross.plus(amount);
  }
  for (const x of input.extras.filter((e) => e.type === "EARNING")) {
    const amount = r(x.amount);
    if (amount.isZero()) continue;
    lines.push({ code: "PRIME", label: x.name, type: "EARNING", category: "OTHER", base: null, rate: null, amount });
    gross = gross.plus(amount);
    if (x.taxable) taxableGross = taxableGross.plus(amount);
  }

  // Retenues salariales, dans l'ordre : l'assiette imposable se réduit des retenues déductibles déjà calculées
  let deductions = d(0), deductibleSoFar = d(0);
  const baseOf = (b: CalcBase) => (b === "BASE" ? baseAmount : b === "GROSS" ? gross : taxableGross.minus(deductibleSoFar));
  for (const it of items.filter((i) => i.type === "DEDUCTION")) {
    const assiette = baseOf(it.base);
    const capped = it.ceiling && assiette.gt(it.ceiling) ? it.ceiling : assiette;
    const amount = it.mode === "FIXED" ? r(it.value) : it.mode === "RATE" ? r(capped.mul(it.value).div(100)) : r(bracketTax(assiette.gt(0) ? assiette : d(0), it.brackets ?? []));
    if (amount.isZero()) continue;
    lines.push({ code: it.code, label: it.name, type: "DEDUCTION", category: it.category, base: it.mode === "FIXED" ? null : capped, rate: it.mode === "RATE" ? it.value : null, amount });
    deductions = deductions.plus(amount);
    if (it.deductibleForTax) deductibleSoFar = deductibleSoFar.plus(amount);
  }
  for (const x of input.extras.filter((e) => e.type === "DEDUCTION")) {
    const amount = r(x.amount);
    if (amount.isZero()) continue;
    lines.push({ code: "RETENUE", label: x.name, type: "DEDUCTION", category: x.category, base: null, rate: null, amount });
    deductions = deductions.plus(amount);
  }

  // Charges patronales (non retenues sur le net)
  let employerCharges = d(0);
  for (const it of items.filter((i) => i.type === "EMPLOYER")) {
    const assiette = baseOf(it.base);
    const capped = it.ceiling && assiette.gt(it.ceiling) ? it.ceiling : assiette;
    const amount = it.mode === "FIXED" ? r(it.value) : it.mode === "RATE" ? r(capped.mul(it.value).div(100)) : r(bracketTax(assiette.gt(0) ? assiette : d(0), it.brackets ?? []));
    if (amount.isZero()) continue;
    lines.push({ code: it.code, label: it.name, type: "EMPLOYER", category: it.category, base: it.mode === "FIXED" ? null : capped, rate: it.mode === "RATE" ? it.value : null, amount });
    employerCharges = employerCharges.plus(amount);
  }

  return { baseAmount, gross, taxableGross, deductions, net: gross.minus(deductions), employerCharges, employerCost: gross.plus(employerCharges), lines };
}
