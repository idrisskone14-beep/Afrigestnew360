import type { AuditFilters } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00.000Z`) : undefined);

/** Filtres d'audit issus de l'URL : toute valeur invalide est ignorée (jamais transmise telle quelle à la base). */
export function parseAuditFilters(get: (key: string) => string | undefined): AuditFilters {
  const to = day(get("au"));
  return {
    q: (get("q") ?? "").trim().slice(0, 100) || undefined,
    userId: get("utilisateur") && UUID.test(get("utilisateur")!) ? get("utilisateur") : undefined,
    resource: /^[A-Za-z]{1,60}$/.test(get("ressource") ?? "") ? get("ressource") : undefined,
    action: /^[a-z_.]{1,60}$/.test(get("action") ?? "") ? get("action") : undefined,
    from: day(get("du")),
    to: to ? new Date(to.getTime() + 86_400_000) : undefined, // « au » est inclusif
  };
}
