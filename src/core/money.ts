import Decimal from "decimal.js";

/**
 * Calculs monétaires exacts (jamais de flottants). Utilisable côté serveur ET client
 * (totaux en direct dans les formulaires de documents).
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Dec = Decimal;
export type Numeric = Decimal | number | string | null | undefined | { toString(): string };

export const d = (v: Numeric): Decimal => (v === null || v === undefined || v === "" ? new Decimal(0) : new Decimal(v.toString()));

/** Devises sans centimes (FCFA…) : arrondi à l'unité. */
const ZERO_DECIMAL = new Set(["XOF", "XAF", "GNF", "CDF", "RWF", "MGA", "KMF", "DJF", "BIF"]);
export const currencyDecimals = (currency: string) => (ZERO_DECIMAL.has(currency) ? 0 : 2);

export function roundMoney(v: Numeric, currency: string): Decimal {
  return d(v).toDecimalPlaces(currencyDecimals(currency), Decimal.ROUND_HALF_UP);
}

export interface LineInput {
  quantity: Numeric;
  unitPrice: Numeric;
  /** Remise en % (0-100) */
  discountPct?: Numeric;
  /** Taux de taxe en % */
  taxRate?: Numeric;
}

export interface LineAmounts {
  gross: Decimal;
  discount: Decimal;
  /** Montant hors taxes après remise */
  net: Decimal;
  tax: Decimal;
  /** Montant TTC */
  total: Decimal;
}

/** Montants d'une ligne : chaque étape est arrondie selon la devise (la somme des lignes = le total). */
export function computeLine(line: LineInput, currency: string): LineAmounts {
  const gross = roundMoney(d(line.quantity).mul(d(line.unitPrice)), currency);
  const discount = roundMoney(gross.mul(d(line.discountPct)).div(100), currency);
  const net = gross.minus(discount);
  const tax = roundMoney(net.mul(d(line.taxRate)).div(100), currency);
  return { gross, discount, net, tax, total: net.plus(tax) };
}

export interface DocumentTotals {
  subtotal: Decimal; // HT avant remises
  discountTotal: Decimal;
  netTotal: Decimal; // HT après remises
  taxTotal: Decimal;
  total: Decimal; // TTC
}

export function computeTotals(lines: LineInput[], currency: string): DocumentTotals {
  const zero = new Decimal(0);
  const t = lines.map((l) => computeLine(l, currency));
  const sum = (f: (a: LineAmounts) => Decimal) => t.reduce((acc, a) => acc.plus(f(a)), zero);
  return {
    subtotal: sum((a) => a.gross),
    discountTotal: sum((a) => a.discount),
    netTotal: sum((a) => a.net),
    taxTotal: sum((a) => a.tax),
    total: sum((a) => a.total),
  };
}

/** Répartition d'un montant en échéances égales ; le dernier terme absorbe l'arrondi (somme exacte). */
export function splitInstallments(total: Numeric, count: number, currency: string): Decimal[] {
  if (count < 1) throw new Error("count doit être ≥ 1");
  const base = roundMoney(d(total).div(count), currency);
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = d(total).minus(base.mul(count - 1));
  return parts;
}

/** Conversion pour l'affichage/sérialisation vers le client (jamais de Decimal à travers la frontière RSC). */
export const num = (v: Numeric): number => d(v).toNumber();
