import type { FilterKey, ReportDef, ReportFilters } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;
const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00.000Z`) : undefined);
const id = (v?: string) => (v && UUID.test(v) ? v : undefined);

/** Paramètres d'URL des filtres (un nom français par filtre). */
export const FILTER_PARAMS: Record<Exclude<FilterKey, "period">, string> = {
  branch: "agence", department: "departement", user: "utilisateur", customer: "client", supplier: "fournisseur", project: "projet", costCenter: "centre",
};

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const yearStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Filtres d'un rapport depuis l'URL. Seuls les filtres déclarés par le rapport sont lus (les autres paramètres sont ignorés),
 * toute valeur invalide est écartée, et la période par défaut du rapport s'applique quand aucune n'est choisie.
 * Les identifiants ne sont jamais crus : les requêtes passent par `ctx.db` (borné à l'entreprise), un identifiant étranger ne renvoie rien.
 */
export function parseReportFilters(def: Pick<ReportDef, "filters" | "defaultPeriod" | "option">, get: (key: string) => string | undefined, now = new Date()): ReportFilters {
  const f: ReportFilters = {};
  if (def.filters.includes("period")) {
    let from = day(get("du")), to = day(get("au"));
    if (!from && !to && def.defaultPeriod !== "none") { from = def.defaultPeriod === "year" ? yearStart(now) : monthStart(now); to = day(isoDay(now)); }
    if (from && to && to < from) [from, to] = [to, from]; // dates inversées : on remet dans l'ordre
    if (from) f.from = from;
    if (to) f.to = new Date(to.getTime() + DAY);
  }
  const map: [FilterKey, keyof ReportFilters][] = [["branch", "branchId"], ["department", "departmentId"], ["user", "userId"], ["customer", "customerId"], ["supplier", "supplierId"], ["project", "projectId"], ["costCenter", "costCenterId"]];
  for (const [k, prop] of map) {
    if (!def.filters.includes(k)) continue;
    const v = id(get(FILTER_PARAMS[k as Exclude<FilterKey, "period">]));
    if (v) (f as Record<string, unknown>)[prop] = v;
  }
  const view = get("vue");
  if (def.option && def.option.choices.some((c) => c.value === view)) f.view = view;
  else if (def.option) f.view = def.option.choices[0]!.value;
  return f;
}

/** Libellé lisible de la période, pour les en-têtes d'export. */
export function periodLabel(f: ReportFilters): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(d);
  if (f.from && f.to) return `du ${fmt(f.from)} au ${fmt(new Date(f.to.getTime() - DAY))}`;
  if (f.from) return `à partir du ${fmt(f.from)}`;
  if (f.to) return `jusqu'au ${fmt(new Date(f.to.getTime() - DAY))}`;
  return "toutes dates";
}

/** Condition de date Prisma pour une période (bornes facultatives). */
export const dateRange = (f: ReportFilters) => (f.from || f.to ? { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } : undefined);
