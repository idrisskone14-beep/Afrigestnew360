import "server-only";
import { renderBusinessDocument, type BusinessDocument } from "@/core/pdf/business-document";
import type { TenantContext } from "@/core/tenant/context";
import { issuer, partyOf, standardTotals, toLines } from "@/modules/sales/pdf";
import { getOrder } from "./procurement";

export const PURCHASE_PDF_PERMISSION = { "purchase-order": "purchases.order.read" } as const;
export type PurchasePdfKind = keyof typeof PURCHASE_PDF_PERMISSION;

/** Bon de commande fournisseur : document envoyé au fournisseur (les prix y figurent). */
export async function buildPurchasePdf(ctx: TenantContext, kind: PurchasePdfKind, id: string): Promise<{ data: Buffer; filename: string }> {
  const base = await issuer(ctx);
  switch (kind) {
    case "purchase-order": {
      const o = await getOrder(ctx, id);
      const doc: BusinessDocument = {
        ...base, title: "BON DE COMMANDE FOURNISSEUR", number: o.number, currency: o.currency, recipient: { ...partyOf(o.supplier), heading: "Fournisseur" },
        status: o.status === "DRAFT" || o.status === "PENDING_APPROVAL" ? { label: o.status === "DRAFT" ? "Brouillon" : "En attente de validation", color: "#64748B" } : o.status === "CANCELLED" ? { label: "Annulée", color: "#DC2626" } : undefined,
        dates: [{ label: "Date de commande", value: o.orderDate }, { label: "Livraison attendue", value: o.expectedDate }],
        lines: toLines(o.lines), totals: standardTotals(o), notes: o.notes,
      };
      return { data: await renderBusinessDocument(doc), filename: `${o.number}.pdf` };
    }
  }
}
