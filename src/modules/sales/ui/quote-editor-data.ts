import "server-only";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { fmtDate } from "@/lib/format";
import { issuer, partyOf } from "../pdf";
import type { getQuote } from "../quotes";
import type { PreviewData } from "./document-preview";
import { loadEditorData } from "./editor-data";

/**
 * Données de l'éditeur de devis : celles de l'éditeur générique + ce qu'il faut pour l'aperçu en direct
 * (coordonnées de l'émetteur et des clients, logo). Tout est lu dans l'entreprise active.
 */
export async function loadQuoteEditorData(ctx: TenantContext) {
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

/** Vue « aperçu » d'un devis enregistré : mêmes blocs et mêmes montants (enregistrés) que le PDF. */
export async function quotePreview(ctx: TenantContext, q: Awaited<ReturnType<typeof getQuote>>): Promise<PreviewData> {
  const iss = await issuer(ctx);
  const lines = q.lines.map((l) => ({
    description: l.description, quantity: num(l.quantity), unit: l.unit, unitPrice: num(l.unitPrice), discountPct: num(l.discountPct),
    taxRate: num(l.taxRate), net: num(l.netAmount), tax: num(l.taxAmount),
  }));
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const l of lines) {
    const cur = byRate.get(l.taxRate) ?? { base: 0, tax: 0 };
    byRate.set(l.taxRate, { base: cur.base + l.net, tax: cur.tax + l.tax });
  }
  const subtotal = num(q.subtotal), discount = num(q.discountTotal);
  return {
    title: q.kind === "PROFORMA" ? "Facture proforma" : "Devis",
    number: q.number,
    currency: q.currency,
    issuer: { name: iss.issuer.name, lines: iss.issuer.lines, legal: iss.issuer.legal, logoUrl: iss.logo ? `/api/files/logo/${ctx.company.id}` : null },
    recipient: partyOf(q.customer),
    dates: [{ label: "Date d'émission", value: fmtDate(q.issueDate) }, { label: "Valable jusqu'au", value: q.validUntil ? fmtDate(q.validUntil) : "—" }],
    lines,
    totals: [
      { label: "Total HT", value: subtotal },
      ...(discount ? [{ label: "Remises", value: -discount }, { label: "Net HT", value: subtotal - discount }] : []),
      { label: "Total TVA", value: num(q.taxTotal) },
      { label: "Total TTC", value: num(q.total) },
      { label: "Net à payer", value: num(q.total), bold: true },
    ],
    breakdown: [...byRate].map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate),
    notes: q.notes ?? "",
    terms: q.terms ?? "",
    signatureLabel: "Bon pour accord — date, nom et signature du client :",
  };
}
