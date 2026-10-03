import "server-only";
import { notFound } from "@/core/errors";
import { num } from "@/core/money";
import { renderBusinessDocument, type BusinessDocument, type PdfLine } from "@/core/pdf/business-document";
import { readCompanyLogo } from "@/core/storage";
import type { TenantContext } from "@/core/tenant/context";
import { countryName } from "@/lib/reference-data";
import { effectiveQuoteStatus, getQuote } from "./quotes";
import { getDelivery, getOrder } from "./orders";
import { getCreditNote, getInvoice, invoiceBalance, isOverdue } from "./invoices";
import { getPayment } from "./payments";

type Ctx = TenantContext;
export type PdfKind = "quote" | "order" | "delivery" | "invoice" | "credit-note" | "receipt";

/** Permission requise pour télécharger chaque type de document. */
export const PDF_PERMISSION: Record<PdfKind, string> = {
  quote: "sales.quote.read", order: "sales.order.read", delivery: "sales.delivery.read", invoice: "finance.invoice.read", "credit-note": "finance.credit_note.read", receipt: "finance.payment.read",
};

export async function issuer(ctx: Ctx): Promise<Pick<BusinessDocument, "issuer" | "logo">> {
  const c = await ctx.db.company.findFirstOrThrow({ where: { id: ctx.company.id } });
  const logo = await readCompanyLogo(c.id).catch(() => null);
  const lines = [c.address, [c.city, c.country ? countryName(c.country) : null].filter(Boolean).join(", "), [c.phone, c.email].filter(Boolean).join(" · ")].filter((x): x is string => Boolean(x));
  const legal = [c.legalName, c.legalForm, c.rccm ? `RCCM ${c.rccm}` : "", c.taxId ? `ID fiscal ${c.taxId}` : ""].filter(Boolean) as string[];
  return { issuer: { name: c.tradeName ?? c.legalName, lines, legal }, logo: logo && logo.mime !== "image/webp" ? logo.data : null };
}

export const partyOf = (c: { name: string; address: string | null; city: string | null; country: string | null; email: string | null; phone: string | null; taxId: string | null }) => ({
  name: c.name, lines: [c.address, [c.city, c.country ? countryName(c.country) : null].filter(Boolean).join(", "), c.phone, c.email, c.taxId ? `ID fiscal ${c.taxId}` : ""].filter((x): x is string => Boolean(x)),
});

type L = { description: string; quantity: unknown; unit: string; unitPrice: unknown; discountPct: unknown; taxRate: unknown; total: unknown };
export const toLines = (lines: L[]): PdfLine[] => lines.map((l) => ({ description: l.description, quantity: num(l.quantity as number), unit: l.unit, unitPrice: num(l.unitPrice as number), discountPct: num(l.discountPct as number), taxRate: num(l.taxRate as number), total: num(l.total as number) }));

type T = { subtotal: unknown; discountTotal?: unknown; taxTotal: unknown; total: unknown };
export const standardTotals = (t: T) => {
  const sub = num(t.subtotal as number), disc = t.discountTotal === undefined ? 0 : num(t.discountTotal as number);
  return [
    { label: "Total HT", value: sub },
    ...(disc ? [{ label: "Remises", value: -disc }, { label: "Net HT", value: sub - disc }] : []),
    { label: "TVA", value: num(t.taxTotal as number) },
    { label: "Total TTC", value: num(t.total as number), bold: true },
  ];
};

export async function buildPdf(ctx: Ctx, kind: PdfKind, id: string): Promise<{ data: Buffer; filename: string }> {
  const base = await issuer(ctx);
  let doc: BusinessDocument;
  let filename: string;

  switch (kind) {
    case "quote": {
      const q = await getQuote(ctx, id);
      const st = effectiveQuoteStatus(q);
      doc = {
        ...base, title: q.kind === "PROFORMA" ? "FACTURE PROFORMA" : "DEVIS", number: q.number, currency: q.currency, recipient: partyOf(q.customer),
        status: st === "ACCEPTED" ? { label: "Accepté", color: "#16A34A" } : st === "EXPIRED" ? { label: "Expiré", color: "#DC2626" } : undefined,
        dates: [{ label: "Date d'émission", value: q.issueDate }, { label: "Valable jusqu'au", value: q.validUntil }], lines: toLines(q.lines), totals: standardTotals(q), notes: q.notes, terms: q.terms,
      };
      filename = q.number;
      break;
    }
    case "order": {
      const o = await getOrder(ctx, id);
      doc = { ...base, title: "BON DE COMMANDE", number: o.number, currency: o.currency, recipient: partyOf(o.customer), dates: [{ label: "Date de commande", value: o.orderDate }, { label: "Livraison prévue", value: o.expectedDelivery }], lines: toLines(o.lines), totals: standardTotals(o), notes: o.notes };
      filename = o.number;
      break;
    }
    case "delivery": {
      const dl = await getDelivery(ctx, id);
      doc = {
        ...base, title: "BON DE LIVRAISON", number: dl.number, currency: ctx.company.currency, recipient: { ...partyOf(dl.customer), heading: "Livré à" }, reference: `Commande ${dl.order.number}`, hidePrices: true,
        status: dl.status === "DELIVERED" ? { label: "Livré", color: "#16A34A" } : { label: "Brouillon", color: "#64748B" }, dates: [{ label: "Date de livraison", value: dl.deliveryDate }],
        lines: dl.lines.map((l) => ({ description: l.description, quantity: num(l.quantity), unit: l.unit, unitPrice: 0, discountPct: 0, taxRate: 0, total: 0 })), notes: dl.notes,
        footer: "Reçu en bon état, le ............ — Nom et signature du client :",
      };
      filename = dl.number;
      break;
    }
    case "invoice": {
      const i = await getInvoice(ctx, id);
      const balance = invoiceBalance(i).toNumber();
      const overdue = isOverdue(i);
      doc = {
        ...base, title: "FACTURE", number: i.number ?? "BROUILLON", currency: i.currency, recipient: partyOf(i.customer),
        status: i.status === "PAID" ? { label: "Payée", color: "#16A34A" } : i.status === "CANCELLED" ? { label: "Annulée", color: "#DC2626" } : i.status === "DRAFT" ? { label: "Brouillon", color: "#64748B" } : overdue ? { label: "Échue", color: "#DC2626" } : undefined,
        dates: [{ label: "Date d'émission", value: i.issueDate }, { label: "Échéance", value: i.dueDate }], lines: toLines(i.lines),
        totals: [
          ...standardTotals(i),
          ...(num(i.creditedAmount) ? [{ label: "Avoirs", value: -num(i.creditedAmount) }] : []),
          ...(num(i.amountPaid) ? [{ label: "Déjà réglé", value: -num(i.amountPaid) }] : []),
          ...(i.status !== "DRAFT" && i.status !== "CANCELLED" ? [{ label: "Reste à payer", value: balance, bold: true }] : []),
        ],
        notes: i.notes, terms: i.terms,
        extraBlocks: [
          { heading: "Échéancier", rows: i.installments.length > 1 ? i.installments.map((x) => [`Échéance ${x.position + 1} — ${x.dueDate.toLocaleDateString("fr-FR")}`, `${num(x.paidAmount) >= num(x.amount) ? "Réglée" : "À régler"}`, num(x.amount).toLocaleString("fr-FR").replace(/[  ]/g, " ")]) : [] },
          { heading: "Paiements reçus", rows: i.payments.filter((p) => p.status === "VALIDATED").map((p) => [`${p.number} — ${p.date.toLocaleDateString("fr-FR")}`, p.method, num(p.amount).toLocaleString("fr-FR").replace(/[  ]/g, " ")]) },
        ],
      };
      filename = i.number ?? `brouillon-${i.id.slice(0, 8)}`;
      break;
    }
    case "credit-note": {
      const cn = await getCreditNote(ctx, id);
      doc = {
        ...base, title: "AVOIR", number: cn.number ?? "BROUILLON", currency: cn.currency, recipient: partyOf(cn.invoice.customer), reference: `Facture ${cn.invoice.number}`,
        dates: [{ label: "Date d'émission", value: cn.issueDate }], lines: toLines(cn.lines),
        totals: [{ label: "Total HT", value: num(cn.subtotal) }, { label: "TVA", value: num(cn.taxTotal) }, { label: "Total avoir", value: num(cn.total), bold: true }], notes: cn.reason ? `Motif : ${cn.reason}` : null,
        status: cn.status === "DRAFT" ? { label: "Brouillon", color: "#64748B" } : undefined,
      };
      filename = cn.number ?? `avoir-${cn.id.slice(0, 8)}`;
      break;
    }
    case "receipt": {
      const p = await getPayment(ctx, id);
      if (!p.invoice || !p.customer) throw notFound("Paiement");
      const inv = await getInvoice(ctx, p.invoice.id);
      doc = {
        ...base, title: "REÇU DE PAIEMENT", number: p.number, currency: p.currency, recipient: { ...partyOf(p.customer), heading: "Reçu de" }, reference: `Facture ${p.invoice.number}`,
        status: p.status === "VALIDATED" ? { label: "Validé", color: "#16A34A" } : p.status === "CANCELLED" ? { label: "Annulé", color: "#DC2626" } : { label: "En attente", color: "#F59E0B" },
        dates: [{ label: "Date du paiement", value: p.date }],
        lines: [{ description: `Règlement de la facture ${p.invoice.number} (${p.method}${p.reference ? ` — réf. ${p.reference}` : ""})`, quantity: 1, unit: "", unitPrice: num(p.amount), discountPct: 0, taxRate: 0, total: num(p.amount) }],
        totals: [{ label: "Montant reçu", value: num(p.amount), bold: true }, ...(p.status === "VALIDATED" ? [{ label: "Reste à payer", value: invoiceBalance(inv).toNumber() }] : [])], notes: p.notes,
      };
      filename = p.number;
      break;
    }
  }
  return { data: await renderBusinessDocument(doc), filename: `${filename}.pdf` };
}
