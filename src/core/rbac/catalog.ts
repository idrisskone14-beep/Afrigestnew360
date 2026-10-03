import type { ModuleKey } from "@/core/modules/registry";

export interface PermissionDef {
  /** Clé publique stable : `domaine.ressource.action` (ex. finance.invoice.read). */
  key: string;
  /** Module qui doit être actif pour que la permission soit effective. */
  module: ModuleKey;
  resource: string;
  action: string;
  label: string;
}

const ACTION_LABELS: Record<string, string> = {
  read: "Consulter",
  create: "Créer",
  update: "Modifier",
  delete: "Supprimer",
  manage: "Gérer",
  validate: "Valider",
  approve: "Approuver",
  invite: "Inviter",
  remove: "Retirer",
  adjust: "Ajuster",
  send: "Envoyer",
  share: "Partager",
  request: "Demander",
  export: "Exporter",
  run: "Exécuter",
  use: "Utiliser",
};

function build(domain: string, module: ModuleKey, resources: Record<string, [label: string, actions: string[]]>): PermissionDef[] {
  return Object.entries(resources).flatMap(([resource, [label, actions]]) =>
    actions.map((action) => ({
      key: `${domain}.${resource}.${action}`,
      module,
      resource,
      action,
      label: `${ACTION_LABELS[action] ?? action} — ${label}`,
    })),
  );
}

const CRUD = ["read", "create", "update", "delete"];

/**
 * Catalogue complet des permissions. Les clés suivent la convention produit
 * (`finance.invoice.*`, `crm.customer.*`, `hr.payroll.manage`, `project.task.manage`…) ;
 * le champ `module` indique le module qui doit être activé (ex. les factures relèvent de « Ventes »).
 */
export const PERMISSIONS: readonly PermissionDef[] = [
  // Cœur (toujours disponible)
  ...build("dashboard", "core", { dashboard: ["Tableau de bord", ["read"]] }),
  ...build("settings", "core", {
    company: ["Paramètres de l'entreprise", ["read", "update"]],
    billing: ["Abonnement et utilisation", ["read"]],
    tax: ["Taxes", ["manage"]],
    numbering: ["Numérotation des documents", ["manage"]],
  }),
  ...build("users", "core", { member: ["Membres", ["read", "invite", "update", "remove"]] }),
  ...build("roles", "core", { role: ["Rôles et permissions", ["read", "manage"]] }),
  ...build("org", "core", { structure: ["Agences, sites, départements, centres de coûts", ["read", "manage"]] }),
  ...build("audit", "core", { log: ["Journal d'audit", ["read"]] }),
  ...build("workflow", "core", { request: ["Demandes d'approbation", ["read", "create", "approve"]], policy: ["Règles d'approbation", ["manage"]] }),
  ...build("data", "core", { import: ["Imports de données", ["manage"]], export: ["Exports de données", ["run"]] }),

  // Finance
  ...build("finance", "sales", {
    invoice: ["Factures", [...CRUD, "send"]],
    credit_note: ["Avoirs", ["read", "create", "update"]],
    payment: ["Encaissements", ["read", "create", "validate"]],
  }),
  ...build("finance", "finance", {
    category: ["Catégories financières", ["manage"]],
    expense: ["Dépenses", [...CRUD, "approve"]],
    account: ["Comptes bancaires et caisses", ["read", "manage"]],
    transfer: ["Transferts", ["create"]],
    budget: ["Budgets et prévisions", ["read", "manage"]],
  }),
  ...build("accounting", "accounting", {
    ledger: ["Grand livre et balance", ["read"]],
    entry: ["Écritures comptables", ["read", "create", "validate"]],
    period: ["Exercices et périodes", ["manage"]],
    chart: ["Plan comptable", ["read", "manage"]],
  }),

  // Ventes & CRM
  ...build("sales", "sales", {
    quote: ["Devis", CRUD],
    order: ["Commandes clients", CRUD],
    delivery: ["Bons de livraison", ["read", "create", "update"]],
    discount: ["Remises", ["approve"]],
  }),
  ...build("crm", "crm", {
    customer: ["Clients", CRUD],
    lead: ["Prospects", CRUD],
    opportunity: ["Opportunités", CRUD],
    activity: ["Activités commerciales", ["read", "create", "update"]],
    pipeline: ["Pipeline commercial", ["manage"]],
  }),

  // Achats & stock
  ...build("purchases", "purchases", {
    supplier: ["Fournisseurs", CRUD],
    request: ["Demandes d'achat", ["read", "create", "approve"]],
    order: ["Commandes fournisseur", [...CRUD, "approve"]],
    receipt: ["Réceptions", ["read", "create"]],
    bill: ["Factures fournisseur", ["read", "create", "update", "approve"]],
    payment: ["Paiements fournisseurs", ["read", "create"]],
    return: ["Retours fournisseur", ["read", "create"]],
  }),
  ...build("inventory", "inventory", {
    product: ["Produits et services", CRUD],
    stock: ["Stocks", ["read", "adjust"]],
    movement: ["Mouvements de stock", ["read", "create"]],
    warehouse: ["Entrepôts", ["manage"]],
    count: ["Inventaires", ["manage"]],
  }),

  // RH & paie
  ...build("hr", "hr", {
    employee: ["Employés", CRUD],
    contract: ["Contrats", ["manage"]],
    attendance: ["Présences", ["read", "manage"]],
    leave: ["Congés", ["read", "request", "approve"]],
    evaluation: ["Évaluations et formations", ["manage"]],
  }),
  ...build("hr", "payroll", { payroll: ["Paie", ["manage"]], payslip: ["Bulletins", ["read"]] }),

  // Projets, GED, rapports
  ...build("project", "projects", {
    project: ["Projets", CRUD],
    task: ["Tâches", ["manage"]],
    time: ["Temps passé", ["manage"]],
  }),
  ...build("documents", "documents", { document: ["Documents", [...CRUD, "share"]] }),
  ...build("reports", "reports", { report: ["Rapports", ["read"]], export: ["Exports de rapports", ["run"]] }),

  // Extensions
  ...build("fleet", "fleet", {
    vehicle: ["Véhicules", ["read", "manage"]],
    driver: ["Chauffeurs", ["manage"]],
    trip: ["Missions et trajets", ["manage"]],
    fuel: ["Carburant", ["manage"]],
    maintenance: ["Entretiens", ["manage"]],
    fine: ["Contraventions", ["read", "manage"]],
  }),
  ...build("construction", "construction", {
    site: ["Chantiers", ["read", "manage"]],
    report: ["Rapports terrain", ["manage"]],
  }),
  ...build("intelligence", "intelligence", { assistant: ["Assistant AfriGest Intelligence", ["use"]] }),
];

export const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDef> = new Map(PERMISSIONS.map((p) => [p.key, p]));

export const isPermissionKey = (key: string) => PERMISSION_BY_KEY.has(key);

if (PERMISSION_BY_KEY.size !== PERMISSIONS.length) {
  throw new Error("Catalogue de permissions : clés dupliquées.");
}

// ───────────────────────────────────────────────────────────────
// Gabarits de rôles copiés dans chaque nouvelle entreprise.
// Motifs : "a.b.c" exact · "a.*" préfixe · "*.read" suffixe de lecture.
// ───────────────────────────────────────────────────────────────

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  isAdmin?: boolean;
  patterns: string[];
}

const BASE = ["dashboard.dashboard.read", "workflow.request.read", "workflow.request.create"];

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  { key: "admin", name: "Administrateur", description: "Accès complet à l'entreprise.", isAdmin: true, patterns: ["*"] },
  { key: "ceo", name: "Directeur Général", description: "Vision globale et validations.", patterns: ["*.read", "workflow.request.*", "reports.*", "data.export.run", "intelligence.*"] },
  { key: "cfo", name: "Directeur Financier", description: "Finance, comptabilité, budgets, approbations.", patterns: [...BASE, "finance.*", "accounting.*", "reports.*", "workflow.request.approve", "sales.discount.approve", "purchases.bill.*", "data.export.run", "intelligence.*", "org.structure.read"] },
  { key: "accountant", name: "Comptable", description: "Saisie et suivi comptable.", patterns: [...BASE, "finance.invoice.read", "finance.payment.*", "finance.expense.*", "finance.category.manage", "finance.account.read", "accounting.*", "reports.report.read", "purchases.bill.read"] },
  { key: "hr", name: "RH", description: "Employés, présences, congés, paie.", patterns: [...BASE, "hr.*", "workflow.request.approve", "reports.report.read", "documents.document.*", "org.structure.read"] },
  { key: "sales_manager", name: "Responsable Commercial", description: "Pilotage des ventes et du CRM.", patterns: [...BASE, "crm.*", "sales.*", "finance.invoice.*", "finance.credit_note.*", "inventory.product.read", "inventory.stock.read", "reports.report.read", "workflow.request.approve"] },
  { key: "sales_rep", name: "Commercial", description: "Prospection et devis.", patterns: [...BASE, "crm.customer.read", "crm.customer.create", "crm.customer.update", "crm.lead.*", "crm.opportunity.*", "crm.activity.*", "sales.quote.*", "sales.order.read", "finance.invoice.read", "inventory.product.read"] },
  { key: "stock_manager", name: "Responsable Stock", description: "Produits, entrepôts, mouvements.", patterns: [...BASE, "inventory.*", "purchases.supplier.read", "purchases.receipt.*", "sales.delivery.*", "reports.report.read"] },
  { key: "project_manager", name: "Chef de Projet", description: "Projets, tâches, temps et budgets.", patterns: [...BASE, "project.*", "documents.document.*", "construction.*", "reports.report.read", "hr.employee.read"] },
  { key: "fleet_manager", name: "Responsable Flotte", description: "Véhicules, chauffeurs, entretiens, contraventions.", patterns: [...BASE, "fleet.*", "documents.document.*", "finance.expense.read", "reports.report.read"] },
  { key: "employee", name: "Employé", description: "Accès de base : congés et tâches.", patterns: [...BASE, "hr.leave.request", "hr.leave.read", "project.task.manage", "hr.payslip.read"] },
  { key: "viewer", name: "Consultation uniquement", description: "Lecture seule.", patterns: ["*.read"] },
];

/** Développe les motifs d'un gabarit en clés de permissions concrètes. */
export function expandPatterns(patterns: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const p of PERMISSIONS) {
    for (const pat of patterns) {
      if (pat === "*" || pat === p.key) keys.add(p.key);
      else if (pat.startsWith("*.")) {
        if (p.key.endsWith(pat.slice(1))) keys.add(p.key);
      } else if (pat.endsWith(".*")) {
        if (p.key.startsWith(pat.slice(0, -1))) keys.add(p.key);
      }
    }
  }
  return [...keys];
}
