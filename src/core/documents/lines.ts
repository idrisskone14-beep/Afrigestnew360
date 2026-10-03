import "server-only";
import { businessRule, notFound } from "@/core/errors";
import { computeLine, computeTotals, d, type Decimal } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import type { LineOutput } from "./line-schema";

type Ctx = Pick<TenantContext, "db" | "company">;

export interface ResolvedLine {
  position: number;
  productId: string | null;
  description: string;
  unit: string;
  quantity: Decimal;
  unitPrice: Decimal;
  discountPct: Decimal;
  taxId: string | null;
  taxRate: Decimal;
  netAmount: Decimal;
  taxAmount: Decimal;
  total: Decimal;
}

export interface Totals {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
}

/**
 * Valide et complète les lignes : produits et taxes DOIVENT appartenir à l'entreprise ; le taux de taxe
 * est lu en base (jamais fourni par le client) ; les montants sont recalculés côté serveur.
 */
export async function resolveLines(ctx: Ctx, input: LineOutput[]): Promise<{ lines: ResolvedLine[]; totals: Totals }> {
  const productIds = [...new Set(input.map((l) => l.productId).filter((x): x is string => Boolean(x)))];
  const taxIds = [...new Set(input.map((l) => l.taxId).filter((x): x is string => Boolean(x)))];
  const [products, taxes] = await Promise.all([
    productIds.length ? ctx.db.product.findMany({ where: { id: { in: productIds }, deletedAt: null }, select: { id: true } }) : [],
    taxIds.length ? ctx.db.tax.findMany({ where: { id: { in: taxIds }, isActive: true }, select: { id: true, rate: true } }) : [],
  ]);
  if (products.length !== productIds.length) throw notFound("Produit");
  if (taxes.length !== taxIds.length) throw businessRule("Taxe inconnue ou désactivée.");
  const rate = new Map(taxes.map((t) => [t.id, d(t.rate)]));
  const cur = ctx.company.currency;

  const lines = input.map((l, i): ResolvedLine => {
    const taxRate = l.taxId ? rate.get(l.taxId)! : d(0);
    const a = computeLine({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, taxRate }, cur);
    return {
      position: i, productId: l.productId || null, description: l.description.trim(), unit: l.unit || "unité", quantity: d(l.quantity), unitPrice: d(l.unitPrice),
      discountPct: d(l.discountPct ?? 0), taxId: l.taxId || null, taxRate, netAmount: a.net, taxAmount: a.tax, total: a.total,
    };
  });
  const t = computeTotals(input.map((l, i) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0, taxRate: lines[i]!.taxRate })), cur);
  return { lines, totals: { subtotal: t.subtotal.toString(), discountTotal: t.discountTotal.toString(), taxTotal: t.taxTotal.toString(), total: t.total.toString() } };
}

/** Lignes prêtes à insérer (sans relation) : Decimal → string pour Prisma. */
export const lineData = (l: ResolvedLine) => ({
  position: l.position, productId: l.productId, description: l.description, unit: l.unit, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(),
  discountPct: l.discountPct.toString(), taxId: l.taxId, taxRate: l.taxRate.toString(), netAmount: l.netAmount.toString(), taxAmount: l.taxAmount.toString(), total: l.total.toString(),
});

export const parseDate = (s: string | undefined | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s) : null);
