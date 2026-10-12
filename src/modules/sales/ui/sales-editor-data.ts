import "server-only";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { fmtDate } from "@/lib/format";
import { issuer, partyOf } from "../pdf";
import type { getInvoice } from "../invoices";
import type { getOrder } from "../orders";
import type { getQuote } from "../quotes";
import type { PreviewData } from "./document-preview";
import { loadEditorData } from "./editor-data";

/**
 * Données de l'éditeur (devis, commande, facture) : celles de l'éditeur générique + ce qu'il faut pour l'aperçu en direct
 * (coordonnées de l'émetteur et des clients, logo). Tout est lu dans l'entreprise active.
 */
export async function loadSalesEditorData(ctx: TenantContext) {
  const [base, customers, iss] = await Promise.all([
    loadEditorData(ctx),
    ctx.db.customer.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, address: true, city: true, country: true, email: true, phone: true, taxId: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    issuer(ctx),
  ]);
  return {
    ...base,
    customers: customers.map((c) => ({ id: c.id, name: c.name, lines: partyOf(c).lines })),
    issuer: { name: iss.issuer.name, lines: iss.issuer.lines, legal: iss.issuer.legal, logoUrl: iss.logo ? `/api/files/logo/${ctx.company.id}` : null },
  };
}

type SavedLine = { description: string; quantity: unknown; unit: string; unitPrice: unknown; discountPct: unknown; taxRate: unknown; netAmount: unknown; taxAmount: unknown };
type SavedDoc = {
  title: string; number: string | null; currency: string; customer: Parameters<typeof partyOf>[0];
  dates: [string, Date | null][]; lines: SavedLine[];
  subtotal: unknown; discountTotal: unknown; taxTotal: unknown; total: unknown; notes: string | null; terms?: string | null;
  netToPay?: boolean; signatureLabel?: string; numberPlaceholder?: string; extraTotals?: { label: string; value: number; bold?: boolean }[];
};

/** Mêmes blocs et mêmes montants (enregistrés) que le PDF : détail de TVA regroupé par taux, récapitulatif. */
async function savedPreview(ctx: TenantContext, s: SavedDoc): Promise<PreviewData> {
  const iss = await issuer(ctx);
  const lines = s.lines.map((l) => ({
    description: l.description, quantity: num(l.quantity as number), unit: l.unit, unitPrice: num(l.unitPrice as number), discountPct: num(l.discountPct as number),
    taxRate: num(l.taxRate as number), net: num(l.netAmount as number), tax: num(l.taxAmount as number),
  }));
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const l of lines) {
    const cur = byRate.get(l.taxRate) ?? { base: 0, tax: 0 };
    byRate.set(l.taxRate, { base: cur.base + l.net, tax: cur.tax + l.tax });
  }
  const subtotal = num(s.subtotal as number), discount = num(s.discountTotal as number), total = num(s.total as number);
  return {
    title: s.title,
    number: s.number,
    ...(s.numberPlaceholder ? { numberPlaceholder: s.numberPlaceholder } : {}),
    currency: s.currency,
    issuer: { name: iss.issuer.name, lines: iss.issuer.lines, legal: iss.issuer.legal, logoUrl: iss.logo ? `/api/files/logo/${ctx.company.id}` : null },
    recipient: partyOf(s.customer),
    dates: s.dates.map(([label, v]) => ({ label, value: v ? fmtDate(v) : "—" })),
    lines,
    totals: [
      { label: "Total HT", value: subtotal },
      ...(discount ? [{ label: "Remises", value: -discount }, { label: "Net HT", value: subtotal - discount }] : []),
      { label: "Total TVA", value: num(s.taxTotal as number) },
      { label: "Total TTC", value: total, bold: !s.netToPay },
      ...(s.netToPay ? [{ label: "Net à payer", value: total, bold: true }] : []),
      ...(s.extraTotals ?? []),
    ],
    breakdown: [...byRate].map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate),
    notes: s.notes ?? "",
    terms: s.terms ?? "",
    ...(s.signatureLabel ? { signatureLabel: s.signatureLabel } : {}),
  };
}

export const quotePreview = (ctx: TenantContext, q: Awaited<ReturnType<typeof getQuote>>) =>
  savedPreview(ctx, {
    ...q, title: q.kind === "PROFORMA" ? "Facture proforma" : "Devis", dates: [["Date d'émission", q.issueDate], ["Valable jusqu'au", q.validUntil]],
    netToPay: true, signatureLabel: "Bon pour accord — date, nom et signature du client :",
  });

export const orderPreview = (ctx: TenantContext, o: Awaited<ReturnType<typeof getOrder>>) =>
  savedPreview(ctx, { ...o, title: "Bon de commande", dates: [["Date de commande", o.orderDate], ["Livraison prévue", o.expectedDelivery]] });

export const invoicePreview = (ctx: TenantContext, i: Awaited<ReturnType<typeof getInvoice>>, balance: number) => {
  const live = i.status !== "DRAFT" && i.status !== "CANCELLED";
  return savedPreview(ctx, {
    ...i, title: i.kind === "DEPOSIT" ? "Facture d'acompte" : "Facture", dates: [["Date d'émission", i.issueDate], ["Échéance", i.dueDate]], numberPlaceholder: "attribué à l'émission",
    extraTotals: [
      ...(num(i.creditedAmount) ? [{ label: "Avoirs", value: -num(i.creditedAmount) }] : []),
      ...(num(i.amountPaid) ? [{ label: "Déjà réglé", value: -num(i.amountPaid) }] : []),
      ...(live ? [{ label: "Reste à payer", value: balance, bold: true }] : []),
    ],
  });
};
