import "server-only";
import { cookies } from "next/headers";
import { dateRangeParam, type SearchParams } from "@/lib/list-params";
import { MAX_YEAR, MIN_YEAR, yearRange, type DateRange } from "@/lib/period";
import { YEAR_COOKIE } from "./cookies";

export { yearOptions, yearRange, type DateRange } from "@/lib/period";

/** Année affichée par les listes et leurs chiffres : celle choisie dans la barre du haut, sinon l'année en cours. */
export async function selectedYear(): Promise<number> {
  const raw = Number((await cookies()).get(YEAR_COOKIE)?.value);
  return Number.isInteger(raw) && raw >= MIN_YEAR && raw <= MAX_YEAR ? raw : new Date().getFullYear();
}

/**
 * Période d'une liste : l'intervalle choisi dans la pastille de date (`<nom>_du` / `<nom>_au`) s'il existe,
 * sinon l'année affichée dans la barre du haut.
 */
export async function periodFor(sp: SearchParams, name: string): Promise<DateRange> {
  const explicit = dateRangeParam(sp, name);
  return explicit.gte || explicit.lt ? explicit : yearRange(await selectedYear());
}
