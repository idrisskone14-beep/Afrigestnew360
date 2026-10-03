/** Types de ressources soumises à approbation et permission métier requise pour décider (chemin « politique simple »). */
export const APPROVAL_TYPES = {
  purchase_request: { label: "Demandes d'achat", permission: "purchases.request.approve", module: "purchases", href: "/app/purchases/demandes" },
  purchase_order: { label: "Commandes fournisseur", permission: "purchases.order.approve", module: "purchases", href: "/app/purchases/commandes" },
  expense: { label: "Dépenses et notes de frais", permission: "finance.expense.approve", module: "finance", href: "/app/finance/depenses" },
  supplier_payment: { label: "Paiements fournisseurs", permission: "purchases.bill.approve", module: "purchases", href: "/app/purchases/paiements" },
  discount: { label: "Remises commerciales", permission: "sales.discount.approve", module: "sales", href: "/app/sales/factures" },
  // Les congés passent toujours par une validation (pas de seuil) : absents des politiques à seuil, mais ouverts aux règles
  leave: { label: "Congés", permission: "hr.leave.approve", module: "hr", href: "/app/hr/conges", alwaysRequired: true },
} as const;
export type ApprovalType = keyof typeof APPROVAL_TYPES;
export const APPROVAL_TYPE_KEYS = Object.keys(APPROVAL_TYPES) as ApprovalType[];
/** Types dont la validation dépend d'un seuil réglable par l'entreprise. */
export const POLICY_TYPE_KEYS = APPROVAL_TYPE_KEYS.filter((t) => !("alwaysRequired" in APPROVAL_TYPES[t]));
/** Types « montant » (les congés sont mesurés en jours). */
export const isApprovalType = (v: string): v is ApprovalType => Object.hasOwn(APPROVAL_TYPES, v);
