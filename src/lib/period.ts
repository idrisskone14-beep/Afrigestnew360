/** Période d'affichage des listes : fonctions pures (la lecture du cookie est dans core/tenant/period.ts). */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export type DateRange = { gte?: Date; lt?: Date };

/** Bornes [début, fin[ de l'année civile, pour filtrer une date. */
export const yearRange = (year: number) => ({ gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) });

/** Années proposées : les cinq dernières, l'année en cours et la suivante (l'année choisie y figure toujours). */
export function yearOptions(selected: number): number[] {
  const now = new Date().getFullYear();
  const years = new Set([now + 1, ...Array.from({ length: 6 }, (_, i) => now - i), selected]);
  return [...years].sort((a, b) => b - a);
}
