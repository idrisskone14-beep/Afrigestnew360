/**
 * Catalogue des notifications : source unique des types (préférences, centre de notifications, émetteurs).
 * `module` = module dont dépend le type (le type n'est proposé que si le module est actif) ; `comingSoon` = émetteur pas encore livré.
 */
export const NOTIFICATION_CATALOG = [
  { type: "invoice.overdue", label: "Facture client échue", module: "sales" },
  { type: "bill.overdue", label: "Facture fournisseur échue", module: "purchases" },
  { type: "stock.low", label: "Stock faible", module: "inventory" },
  { type: "approval.pending", label: "Demande à valider" },
  { type: "approval.decided", label: "Décision sur ma demande" },
  { type: "leave.request", label: "Congé", module: "hr" },
  { type: "payment.received", label: "Paiement reçu", module: "sales" },
  { type: "due_date", label: "Échéance proche" },
  { type: "task.assigned", label: "Tâche", module: "projects" },
  { type: "document.expiring", label: "Document expirant", module: "documents" },
  { type: "contract.ending", label: "Contrat arrivant à échéance", module: "hr" },
  { type: "maintenance.due", label: "Entretien de véhicule", module: "fleet" },
  { type: "vehicle.expiring", label: "Assurance, visite technique, permis", module: "fleet" },
  { type: "fine.due", label: "Contravention à payer", module: "fleet" },
  { type: "subscription", label: "Abonnement" },
] as const;
export type NotificationType = (typeof NOTIFICATION_CATALOG)[number]["type"];
export const NOTIFICATION_TYPE_KEYS: readonly string[] = NOTIFICATION_CATALOG.map((t) => t.type);
