import type { TenantContext } from "./context";

/** Geste rapide proposé par le bouton « + » de la barre mobile : un lien, ou l'ouverture du scanner. */
export interface QuickAction {
  key: string;
  label: string;
  icon: "FileText" | "Receipt" | "ShoppingBag" | "ShoppingCart" | "ClipboardList" | "ScanBarcode" | "Camera";
  href?: string;
  kind?: "scan";
}

type Ctx = Pick<TenantContext, "can" | "hasModule">;

/** Gestes rapides auxquels l'utilisateur a droit (module actif ET permission), du plus fréquent au moins fréquent. */
export function quickActionsFor(ctx: Ctx): QuickAction[] {
  const list: (QuickAction & { show: boolean })[] = [
    { key: "quote", label: "Nouveau devis", icon: "FileText", href: "/app/sales/devis/nouveau", show: ctx.hasModule("sales") && ctx.can("sales.quote.create") },
    { key: "invoice", label: "Nouvelle facture", icon: "Receipt", href: "/app/sales/factures/nouveau", show: ctx.hasModule("sales") && ctx.can("finance.invoice.create") },
    { key: "order", label: "Nouvelle commande", icon: "ShoppingBag", href: "/app/sales/commandes/nouveau", show: ctx.hasModule("sales") && ctx.can("sales.order.create") },
    { key: "scan", label: "Scanner un produit", icon: "ScanBarcode", kind: "scan", show: ctx.hasModule("inventory") && ctx.can("inventory.product.read") },
    { key: "receipt", label: "Photographier un justificatif", icon: "Camera", href: "/app/capture", show: ctx.hasModule("finance") && ctx.can("finance.expense.create") && ctx.hasModule("documents") && ctx.can("documents.document.create") },
    { key: "purchase", label: "Commande fournisseur", icon: "ShoppingCart", href: "/app/purchases/commandes/nouveau", show: ctx.hasModule("purchases") && ctx.can("purchases.order.create") },
    { key: "request", label: "Demande d'achat", icon: "ClipboardList", href: "/app/purchases/demandes/nouveau", show: ctx.hasModule("purchases") && ctx.can("purchases.request.create") },
  ];
  return list.filter((a) => a.show).map(({ show: _show, ...a }) => a);
}
