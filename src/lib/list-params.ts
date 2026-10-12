export const PAGE_SIZE = 20;
/** Tailles de page proposées dans le sélecteur « Lignes ». */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface ListParams {
  q: string;
  page: number;
  skip: number;
  take: number;
}

/** Nombre de lignes par page choisi dans l'URL (`lignes`), limité aux tailles proposées. */
export function pageSizeOf(sp: SearchParams, fallback = PAGE_SIZE): number {
  const n = Number(first(sp.lignes));
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
}

/** Paramètres de liste standard (recherche + pagination) lus depuis l'URL. */
export function parseListParams(sp: SearchParams, pageSize = pageSizeOf(sp)): ListParams {
  const page = Math.max(1, Math.floor(Number(first(sp.page))) || 1);
  return { q: (first(sp.q) ?? "").trim().slice(0, 100), page, skip: (page - 1) * pageSize, take: pageSize };
}

export const param = (sp: SearchParams, key: string) => first(sp[key]);

/** Valeur d'enum issue de l'URL, ou undefined si invalide (jamais de valeur arbitraire vers Prisma). */
export function enumParam<T extends string>(sp: SearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = first(sp[key]);
  return allowed.find((a) => a === v);
}

export function buildQuery(base: SearchParams, patch: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    const val = first(v);
    if (val) p.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Intervalle de dates lu dans l'URL (`<nom>_du` / `<nom>_au`, au format AAAA-MM-JJ) ; bornes absentes si invalides. */
export function dateRangeParam(sp: SearchParams, name: string): { gte?: Date; lt?: Date } {
  const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00.000Z`) : undefined);
  const from = day(first(sp[`${name}_du`]));
  const to = day(first(sp[`${name}_au`]));
  return { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) };
}
