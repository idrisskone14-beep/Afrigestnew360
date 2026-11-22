/** Types de ressources soumises à approbation et permission métier requise pour décider (chemin « politique simple »). */
export const APPROVAL_TYPES = {
  purchase_request: { label: "Demandes d'achat", permission: "purchases.request.approve", module: "purchases", href: "/app/purchases/demandes" },
  purchase_order: { label: "Commandes fournisseur", permission: "purchases.order.approve", module: "purchases", href: "/app/purchases/commandes" },
  expense: { label: "Dépenses et notes de frais", permission: "finance.expense.approve", module: "finance", href: "/app/finance/depenses" },
  supplier_payment: { label: "Paiements fournisseurs", permission: "purchases.bill.approve", module: "purchases", href: "/app/purchases/paiements" },
  discount: { label: "Remises commerciales", permission: "sales.discount.approve", module: "sales", href: "/app/sales/factures" },
  // Les congés passent toujours par une validation (pas de seuil) : absents des politiques à seuil, mais ouverts aux règles
  leave: { label: "Congés", permission: "hr.leave.approve", module: "hr", href: "/app/hr/conges", alwaysRequired: true, unit: "days" },
  // Registres RH : toujours validés, sans seuil (le montant du circuit est une durée en jours ; pour une permission horaire, voir le titre de la demande)
  timeoff: { label: "Permissions d'absence", permission: "hr.timeoff.approve", module: "hr", href: "/app/hr/permissions", alwaysRequired: true, unit: "none" },
  overtime: { label: "Heures supplémentaires", permission: "hr.overtime.approve", module: "hr", href: "/app/hr/heures-supplementaires", alwaysRequired: true, unit: "none" },
  // montant : la demande s'affiche en monnaie dans « Validations »
  advance: { label: "Avances et acomptes", permission: "hr.advance.approve", module: "hr", href: "/app/hr/avances", alwaysRequired: true },
  absence: { label: "Absences", permission: "hr.absence.approve", module: "hr", href: "/app/hr/absences", alwaysRequired: true, unit: "days" },
} as const;
export type ApprovalType = keyof typeof APPROVAL_TYPES;
export const APPROVAL_TYPE_KEYS = Object.keys(APPROVAL_TYPES) as ApprovalType[];
/** Types dont la validation dépend d'un seuil réglable par l'entreprise. */
export const POLICY_TYPE_KEYS = APPROVAL_TYPE_KEYS.filter((t) => !("alwaysRequired" in APPROVAL_TYPES[t]));
/** Types « montant » (les congés sont mesurés en jours). */
export const isApprovalType = (v: string): v is ApprovalType => Object.hasOwn(APPROVAL_TYPES, v);
