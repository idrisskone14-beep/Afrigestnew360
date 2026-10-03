export type ModuleKind = "CORE" | "STANDARD" | "EXTENSION";

/** `available` : fonctionnel dans l'application. `planned` : architecture prête, écrans livrés dans une phase ultérieure. */
export type DeliveryStatus = "available" | "planned";

export interface ModuleDef {
  key: string;
  name: string;
  description: string;
  kind: ModuleKind;
  /** Nom d'icône lucide-react (résolu côté UI). */
  icon: string;
  sortOrder: number;
  status: DeliveryStatus;
}

export const MODULES = [
  { key: "core", name: "Cœur", description: "Tableau de bord, utilisateurs, rôles, paramètres, audit.", kind: "CORE", icon: "LayoutDashboard", sortOrder: 0, status: "available" },
  { key: "finance", name: "Finance", description: "Recettes, dépenses, banques, caisses, budgets, échéances.", kind: "STANDARD", icon: "Wallet", sortOrder: 10, status: "available" },
  { key: "accounting", name: "Comptabilité", description: "Plan comptable SYSCOHADA, journaux, écritures, états financiers.", kind: "STANDARD", icon: "BookOpenCheck", sortOrder: 15, status: "available" },
  { key: "sales", name: "Ventes & Facturation", description: "Devis, commandes, livraisons, factures, avoirs, paiements.", kind: "STANDARD", icon: "ReceiptText", sortOrder: 20, status: "available" },
  { key: "crm", name: "CRM & Clients", description: "Prospects, clients, opportunités, pipeline, activités.", kind: "STANDARD", icon: "Users", sortOrder: 30, status: "available" },
  { key: "purchases", name: "Achats & Fournisseurs", description: "Demandes, commandes, réceptions, factures fournisseur.", kind: "STANDARD", icon: "ShoppingCart", sortOrder: 40, status: "available" },
  { key: "inventory", name: "Stock & Inventaire", description: "Produits, entrepôts, mouvements, inventaires, alertes.", kind: "STANDARD", icon: "Boxes", sortOrder: 50, status: "available" },
  { key: "hr", name: "Ressources humaines", description: "Employés, présences, congés, contrats, évaluations.", kind: "STANDARD", icon: "UserRoundCog", sortOrder: 60, status: "available" },
  { key: "payroll", name: "Paie", description: "Périodes, rubriques configurables, bulletins PDF.", kind: "STANDARD", icon: "Banknote", sortOrder: 65, status: "available" },
  { key: "projects", name: "Projets & Tâches", description: "Projets, tâches, Kanban, Gantt, temps et budgets.", kind: "STANDARD", icon: "KanbanSquare", sortOrder: 70, status: "available" },
  { key: "documents", name: "Documents (GED)", description: "Dossiers, versions, partage, liens vers les entités.", kind: "STANDARD", icon: "FolderOpen", sortOrder: 80, status: "available" },
  { key: "reports", name: "Rapports & Analytics", description: "Reporting transversal, exports PDF/Excel.", kind: "STANDARD", icon: "BarChart3", sortOrder: 90, status: "available" },
  { key: "fleet", name: "Transport & Flotte", description: "Véhicules, chauffeurs, missions, entretiens, contraventions.", kind: "EXTENSION", icon: "Truck", sortOrder: 100, status: "available" },
  { key: "construction", name: "Gestion de chantiers", description: "Chantiers, équipes, matériaux, rapports terrain.", kind: "EXTENSION", icon: "HardHat", sortOrder: 110, status: "available" },
  { key: "intelligence", name: "AfriGest Intelligence", description: "Assistant d'analyse limité aux données autorisées.", kind: "EXTENSION", icon: "Sparkles", sortOrder: 120, status: "planned" },
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_BY_KEY: ReadonlyMap<string, ModuleDef> = new Map(MODULES.map((m) => [m.key, m]));

/** Le cœur est toujours actif et ne peut pas être retiré d'une entreprise. */
export const ALWAYS_ENABLED: readonly ModuleKey[] = ["core"];

export const isModuleKey = (key: string): key is ModuleKey => MODULE_BY_KEY.has(key);

/** Limites d'usage gérées par plan / entreprise. -1 = illimité. */
export const LIMIT_KEYS = [
  { key: "users", label: "Utilisateurs" },
  { key: "employees", label: "Employés" },
  { key: "products", label: "Produits" },
  { key: "customers", label: "Clients" },
  { key: "projects", label: "Projets" },
  { key: "vehicles", label: "Véhicules" },
  { key: "storage_mb", label: "Stockage (Mo)" },
  { key: "documents", label: "Documents" },
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number]["key"];

export const UNLIMITED = -1;
