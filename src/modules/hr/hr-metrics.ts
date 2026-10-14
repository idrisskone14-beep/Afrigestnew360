/**
 * Indicateurs RH — fonctions PURES (aucun accès base) : testables, et définitions écrites une fois.
 *
 * Définitions :
 *  - un salarié est « présent à la date D » s'il est arrivé au plus tard à D et ne part pas avant D (le jour de départ compte comme présent) ;
 *  - taux de rotation de l'année = départs de l'année ÷ effectif moyen ((effectif au 1er janvier + effectif de fin de période) ÷ 2) ;
 *  - taux d'absentéisme = jours « absent » pointés ÷ jours pointés : il ne mesure que ce qui est enregistré dans les présences ;
 *  - taux de congé = jours de congé pris ÷ (effectif moyen × jours travaillés de la période).
 */
const DAY = 86_400_000;
const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
const utc = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));
export const monthKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;

export interface Person { hireDate: Date; endDate: Date | null; birthDate?: Date | null }

export const isPresentAt = (p: Person, at: Date) => day(p.hireDate) <= day(at) && (!p.endDate || day(p.endDate) >= day(at));
export const headcountAt = (rows: Person[], at: Date) => rows.filter((p) => isPresentAt(p, at)).length;

export interface MonthMovement { month: string; headcount: number; entries: number; exits: number }

/** Effectif de fin de mois, arrivées et départs de chaque mois de l'année (mois à venir : effectif de la date de référence). */
export function monthlyMovements(rows: Person[], year: number, asOf: Date): MonthMovement[] {
  return Array.from({ length: 12 }, (_, m) => {
    const start = utc(year, m, 1), end = utc(year, m + 1, 0);
    const future = start > day(asOf);
    return {
      month: monthKey(year, m),
      headcount: headcountAt(rows, future ? asOf : end < day(asOf) ? end : asOf),
      entries: future ? 0 : rows.filter((p) => { const h = day(p.hireDate); return h >= start && h <= end; }).length,
      exits: future ? 0 : rows.filter((p) => { const e = p.endDate && day(p.endDate); return e && e >= start && e <= end; }).length,
    };
  });
}

/** Taux de rotation en % (1 décimale), ou null si l'effectif moyen est nul. */
export function turnoverRate(exits: number, headStart: number, headEnd: number): number | null {
  const avg = (headStart + headEnd) / 2;
  return avg > 0 ? Math.round((exits / avg) * 1000) / 10 : null;
}

export function averageTenureYears(rows: Person[], at: Date): number | null {
  const present = rows.filter((p) => isPresentAt(p, at));
  if (present.length === 0) return null;
  const years = present.reduce((a, p) => a + (day(at).getTime() - day(p.hireDate).getTime()) / (365.25 * DAY), 0) / present.length;
  return Math.round(years * 10) / 10;
}

export const AGE_BRACKETS = [{ label: "Moins de 25 ans", max: 24 }, { label: "25 à 34 ans", max: 34 }, { label: "35 à 44 ans", max: 44 }, { label: "45 à 54 ans", max: 54 }, { label: "55 ans et plus", max: Infinity }] as const;

/** Pyramide des âges des salariés présents ; « non renseigné » regroupe ceux sans date de naissance. */
export function ageBrackets(rows: Person[], at: Date): { label: string; count: number }[] {
  const present = rows.filter((p) => isPresentAt(p, at));
  const counts = AGE_BRACKETS.map(() => 0);
  let unknown = 0;
  for (const p of present) {
    if (!p.birthDate) { unknown++; continue; }
    const b = day(p.birthDate), a = day(at);
    let age = a.getUTCFullYear() - b.getUTCFullYear();
    if (a.getUTCMonth() < b.getUTCMonth() || (a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() < b.getUTCDate())) age--;
    counts[AGE_BRACKETS.findIndex((x) => age <= x.max)]!++;
  }
  return [...AGE_BRACKETS.map((x, i) => ({ label: x.label, count: counts[i]! })), ...(unknown ? [{ label: "Non renseigné", count: unknown }] : [])];
}

/** Pourcentage à 1 décimale ; null si le dénominateur est nul. */
export const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** Répartition des jours d'une demande entre les mois qu'elle chevauche (au prorata des jours calendaires) : 12 valeurs pour `year`. */
export function spreadLeaveDays(requests: { startDate: Date; endDate: Date; days: number }[], year: number): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  for (const r of requests) {
    const s = day(r.startDate).getTime(), e = day(r.endDate).getTime();
    const total = (e - s) / DAY + 1;
    for (let m = 0; m < 12; m++) {
      const from = Math.max(s, utc(year, m, 1).getTime()), to = Math.min(e, utc(year, m + 1, 0).getTime());
      if (to >= from) out[m]! += (r.days * ((to - from) / DAY + 1)) / total;
    }
  }
  return out.map((v) => Math.round(v * 10) / 10);
}

/** Plus grand nombre d'absents le même jour, et les jours concernés. */
export function absencePeak(perDay: Map<string, number>): { max: number; dates: string[] } {
  let max = 0;
  for (const v of perDay.values()) max = Math.max(max, v);
  return { max, dates: max === 0 ? [] : [...perDay].filter(([, v]) => v === max).map(([k]) => k).sort() };
}

/** Date au format AAAA-MM-JJ (UTC). */
export const isoDate = (v: Date) => v.toISOString().slice(0, 10);
