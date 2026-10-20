import type { TenantContext } from "./context";

/** Entrée de sous-menu d'un module (une page de liste ou de synthèse). `exact` : active seulement sur l'URL exacte. */
export interface NavItem { href: string; label: string; exact?: boolean }

type Can = TenantContext["can"];
interface ItemDef extends NavItem { show: (can: Can) => boolean }

const always = () => true;
const any = (...keys: string[]) => (can: Can) => keys.some((k) => can(k));

/**
 * Sous-menus des modules : une seule définition pour le menu latéral et les titres de page.
 * Chaque entrée est filtrée selon les droits de l'utilisateur ; chaque page revérifie côté serveur.
 */
const ITEMS: Record<string, (ctx: Pick<TenantContext, "can">) => ItemDef[]> = {
  finance: () => [
    { href: "/app/finance", label: "Vue d'ensemble", exact: true, show: always },
    { href: "/app/finance/comptes", label: "Comptes", show: any("finance.account.read") },
    { href: "/app/finance/mouvements", label: "Mouvements", show: any("finance.account.read") },
    { href: "/app/finance/depenses", label: "Dépenses", show: any("finance.expense.read") },
    { href: "/app/finance/echeancier", label: "Échéancier", show: any("finance.account.read") },
    { href: "/app/finance/budgets", label: "Budgets", show: any("finance.budget.read") },
    { href: "/app/finance/categories", label: "Catégories", show: any("finance.account.read", "finance.category.manage") },
  ],
  accounting: () => [
    { href: "/app/accounting", label: "Vue d'ensemble", exact: true, show: always },
    { href: "/app/accounting/ecritures", label: "Écritures", show: any("accounting.entry.read") },
    { href: "/app/accounting/grand-livre", label: "Grand livre", show: any("accounting.ledger.read") },
    { href: "/app/accounting/balance", label: "Balance", show: any("accounting.ledger.read") },
    { href: "/app/accounting/etats", label: "États financiers", show: any("accounting.ledger.read") },
    { href: "/app/accounting/plan", label: "Plan comptable", show: any("accounting.chart.read") },
    { href: "/app/accounting/exercices", label: "Exercices", show: any("accounting.ledger.read") },
  ],
  sales: () => [
    { href: "/app/sales", label: "Vue d'ensemble", exact: true, show: always },
    { href: "/app/sales/devis", label: "Devis clients", show: any("sales.quote.read") },
    { href: "/app/sales/commandes", label: "Bons de commande", show: any("sales.order.read") },
    { href: "/app/sales/livraisons", label: "Bons de livraison", show: any("sales.delivery.read") },
    { href: "/app/sales/factures", label: "Factures de vente", show: any("finance.invoice.read") },
    { href: "/app/sales/recurrentes", label: "Factures récurrentes", show: any("finance.invoice.read") },
    { href: "/app/sales/paiements", label: "Paiements", show: any("finance.payment.read") },
    { href: "/app/sales/avoirs", label: "Avoirs", show: any("finance.credit_note.read") },
    { href: "/app/sales/relances", label: "Relances", show: any("finance.invoice.read") },
    { href: "/app/sales/listes-de-prix", label: "Listes de prix", show: any("sales.pricelist.manage") },
  ],
  crm: () => [
    { href: "/app/crm", label: "Vue d'ensemble", exact: true, show: always },
    { href: "/app/crm/clients", label: "Clients", show: any("crm.customer.read") },
    { href: "/app/crm/prospects", label: "Prospects", show: any("crm.lead.read") },
    { href: "/app/crm/opportunites", label: "Opportunités", show: any("crm.opportunity.read") },
    { href: "/app/crm/activites", label: "Activités", show: any("crm.activity.read") },
    { href: "/app/crm/pipeline", label: "Pipeline", show: any("crm.pipeline.manage") },
  ],
  purchases: () => [
    { href: "/app/purchases", label: "Vue d'ensemble", exact: true, show: always },
    { href: "/app/purchases/fournisseurs", label: "Fournisseurs", show: any("purchases.supplier.read") },
    { href: "/app/purchases/demandes", label: "Demandes d'achat", show: any("purchases.request.read") },
    { href: "/app/purchases/commandes", label: "Bons de commande", show: any("purchases.order.read") },
    { href: "/app/purchases/receptions", label: "Réceptions", show: any("purchases.receipt.read") },
    { href: "/app/purchases/factures", label: "Factures fournisseur", show: any("purchases.bill.read") },
    { href: "/app/purchases/paiements", label: "Paiements", show: any("purchases.payment.read") },
  ],
  inventory: () => [
    { href: "/app/inventory", label: "Vue d'ensemble", exact: true, show: any("inventory.stock.read", "inventory.product.read") },
    { href: "/app/inventory/produits", label: "Produits", show: any("inventory.product.read") },
    { href: "/app/inventory/mouvements", label: "Mouvements", show: any("inventory.movement.read") },
    { href: "/app/inventory/inventaire", label: "Inventaire", show: any("inventory.count.manage") },
    { href: "/app/inventory/entrepots", label: "Entrepôts & catégories", show: any("inventory.product.read", "inventory.warehouse.manage") },
  ],
  hr: () => [
    { href: "/app/hr", label: "Vue d'ensemble", exact: true, show: always },
    { href: "/app/hr/indicateurs", label: "Indicateurs RH", show: any("hr.employee.read") },
    { href: "/app/hr/salaries", label: "Salariés", show: any("hr.employee.read") },
    { href: "/app/hr/conges", label: "Congés", show: any("hr.leave.read", "hr.leave.request") },
    { href: "/app/hr/suivi-conges", label: "Suivi des congés", show: any("hr.employee.read", "hr.leave.approve") },
    { href: "/app/hr/presences", label: "Présences", show: any("hr.attendance.read") },
    { href: "/app/hr/feries", label: "Jours fériés", show: any("hr.employee.read", "hr.holiday.manage") },
  ],
  payroll: ({ can }) => {
    const manage = can("hr.payroll.manage");
    return [
      { href: "/app/payroll", label: "Campagnes", exact: true, show: () => manage },
      { href: "/app/payroll/bulletins", label: manage ? "Bulletins" : "Mes bulletins", show: () => manage || can("hr.payslip.read") },
      { href: "/app/payroll/rubriques", label: "Rubriques", show: () => manage },
    ];
  },
  projects: () => [
    { href: "/app/projects", label: "Projets", exact: true, show: any("project.project.read") },
    { href: "/app/projects/mes-taches", label: "Mes tâches", show: any("project.task.manage") },
    { href: "/app/projects/temps", label: "Temps passé", show: any("project.time.manage", "project.task.manage") },
  ],
  fleet: () => [
    { href: "/app/fleet", label: "Vue d'ensemble", exact: true, show: any("fleet.vehicle.read") },
    { href: "/app/fleet/vehicules", label: "Véhicules", show: any("fleet.vehicle.read") },
    { href: "/app/fleet/chauffeurs", label: "Chauffeurs", show: any("fleet.vehicle.read", "fleet.driver.manage") },
    { href: "/app/fleet/missions", label: "Missions", show: any("fleet.vehicle.read", "fleet.trip.manage") },
    { href: "/app/fleet/carburant", label: "Carburant", show: any("fleet.vehicle.read", "fleet.fuel.manage") },
    { href: "/app/fleet/entretiens", label: "Entretiens", show: any("fleet.vehicle.read", "fleet.maintenance.manage") },
    { href: "/app/fleet/contraventions", label: "Contraventions", show: any("fleet.fine.read") },
  ],
};

/** Sous-menu d'un module, limité aux pages que l'utilisateur peut ouvrir. Vide : le module n'a qu'une page. */
export function moduleItems(ctx: Pick<TenantContext, "can">, moduleKey: string): NavItem[] {
  return (ITEMS[moduleKey]?.(ctx) ?? []).filter((i) => i.show(ctx.can)).map(({ href, label, exact }) => ({ href, label, ...(exact ? { exact } : {}) }));
}

/**
 * Familles de modules : un onglet du rail d'icônes = une famille. Le menu latéral ne détaille que les modules de la famille
 * ouverte, ce qui garde un menu court même quand tous les modules sont activés.
 */
export const FAMILIES = [
  { key: "gestion", label: "Gestion commerciale", code: "Com", color: "#7b1ff0", modules: ["sales", "crm", "purchases", "inventory"] },
  { key: "finance", label: "Finance et comptabilité", code: "Fin", color: "#0b63e5", modules: ["finance", "accounting"] },
  { key: "rh", label: "Ressources humaines et paie", code: "RH", color: "#0d0b45", modules: ["hr", "payroll"] },
  { key: "projets", label: "Projets et chantiers", code: "Prj", color: "#d97706", modules: ["projects", "construction"] },
  { key: "transport", label: "Transport et flotte", code: "Trp", color: "#0e7490", modules: ["fleet"] },
  { key: "documents", label: "Documents et analyses", code: "Doc", color: "#475569", modules: ["documents", "reports", "intelligence"] },
] as const;

export type FamilyKey = (typeof FAMILIES)[number]["key"];
export const familyOfModule = (moduleKey: string) => FAMILIES.find((f) => (f.modules as readonly string[]).includes(moduleKey))?.key;
