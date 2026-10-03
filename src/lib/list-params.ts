export const PAGE_SIZE = 20;

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface ListParams {
  q: string;
  page: number;
  skip: number;
  take: number;
}

/** Paramètres de liste standard (recherche + pagination) lus depuis l'URL. */
export function parseListParams(sp: SearchParams, pageSize = PAGE_SIZE): ListParams {
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
