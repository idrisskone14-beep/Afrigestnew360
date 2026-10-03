import type { ExportTable } from "@/core/export/table";
import type { TenantContext } from "@/core/tenant/context";

/** Filtres transversaux du centre de reporting (l'entreprise est toujours l'entreprise active : changez-la avec le sélecteur). */
export type FilterKey = "period" | "branch" | "department" | "user" | "customer" | "supplier" | "project" | "costCenter";

export interface ReportFilters {
  /** Début de période (inclus), UTC. */
  from?: Date;
  /** Fin de période EXCLUE (lendemain du dernier jour choisi), UTC. */
  to?: Date;
  branchId?: string;
  departmentId?: string;
  userId?: string;
  customerId?: string;
  supplierId?: string;
  projectId?: string;
  costCenterId?: string;
  /** Variante d'affichage propre au rapport (ex. détail ou regroupé). */
  view?: string;
}

export interface ReportOption { key: "view"; label: string; choices: { value: string; label: string }[] }

export interface ReportResult {
  table: ExportTable;
  /** Indicateurs clés affichés au-dessus du tableau. */
  summary: { label: string; value: string }[];
  /** Série mensuelle optionnelle (barres). */
  chart?: { seriesLabel: string; data: { month: string; value: number }[] };
  /** Vrai si le résultat a été plafonné (affiché pour éviter de faire croire à un total complet). */
  truncated?: boolean;
}

export type ReportGroup = "Ventes et clients" | "Finance et comptabilité" | "Achats et stocks" | "Ressources humaines" | "Projets" | "Flotte et chantiers";

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  group: ReportGroup;
  /** Module requis (actif) et permission de lecture des données sources ; `reports.report.read` est toujours exigé en plus. */
  module: string;
  permission: string;
  /** Filtres réellement pris en compte par ce rapport : seuls ceux-là sont proposés (aucun filtre décoratif). */
  filters: FilterKey[];
  option?: ReportOption;
  /** Période par défaut quand aucune n'est choisie : mois en cours, année en cours ou aucune (situation à ce jour). */
  defaultPeriod: "month" | "year" | "none";
  run: (ctx: TenantContext, f: ReportFilters) => Promise<ReportResult>;
}

/** Plafond de lignes d'un rapport (affichage et exports) : au-delà, le rapport est signalé comme tronqué. */
export const REPORT_MAX_ROWS = 5000;
