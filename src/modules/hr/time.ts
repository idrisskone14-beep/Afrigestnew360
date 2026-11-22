/**
 * Calculs de temps des registres RH — fonctions PURES (aucun accès base), testables et rejouables.
 *
 * Convention : les heures sont des textes « HH:MM » en heure LOCALE de l'entreprise, sans fuseau ; les jours sont des dates UTC à minuit.
 * Un « intervalle » est exprimé en minutes depuis le 1er janvier 1970 (heure locale « naïve ») : cela permet de comparer sans ambiguïté
 * des périodes à cheval sur deux journées.
 */
import { isoDay, type WorkCalendar } from "./leave-calc";

const DAY_MS = 86_400_000;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DAY_MINUTES = 1440;

/** « 08:30 » → 510. */
export function toMinutes(t: string): number {
  if (!TIME_RE.test(t)) throw new RangeError(`Heure invalide : ${t}`);
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

/** 510 → « 08:30 ». */
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** « 2027-03-01 » → date UTC à minuit ; null si le texte n'est pas une vraie date du calendrier. */
export function parseDay(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

export const dayOf = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
export const addDays = (v: Date, n: number) => new Date(v.getTime() + n * DAY_MS);
const epochMinutes = (day: Date) => Math.round(dayOf(day).getTime() / 60_000);

export interface Schedule { start: string; end: string; breakStart: string | null; breakEnd: string | null }
export const DEFAULT_SCHEDULE: Schedule = { start: "08:00", end: "17:00", breakStart: null, breakEnd: null };

/** Plages de travail d'une journée (avant et après la pause éventuelle), en minutes depuis minuit. */
export function workWindows(s: Schedule): [number, number][] {
  const a = toMinutes(s.start), b = toMinutes(s.end);
  if (b <= a) throw new RangeError("L'heure de fin de journée doit suivre l'heure de début.");
  if (s.breakStart && s.breakEnd) {
    const p = toMinutes(s.breakStart), q = toMinutes(s.breakEnd);
    if (p > a && q > p && q < b) return [[a, p], [q, b]];
  }
  return [[a, b]];
}

/** Heures de travail effectives (en minutes) entre deux instants locaux, jours non travaillés et jours fériés exclus. Gère les périodes sur plusieurs jours. */
export function workMinutesBetween(startDate: Date, startTime: string, endDate: Date, endTime: string, schedule: Schedule, cal: WorkCalendar): number {
  const first = dayOf(startDate), last = dayOf(endDate);
  const windows = workWindows(schedule);
  let total = 0;
  for (let t = first.getTime(); t <= last.getTime(); t += DAY_MS) {
    const dt = new Date(t);
    if (!cal.workDays.has(dt.getUTCDay()) || cal.holidays.has(isoDay(dt))) continue;
    const lo = t === first.getTime() ? toMinutes(startTime) : 0;
    const hi = t === last.getTime() ? toMinutes(endTime) : DAY_MINUTES;
    for (const [a, b] of windows) total += Math.max(0, Math.min(hi, b) - Math.max(lo, a));
  }
  return total;
}

export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

// ── Chevauchements ─────────────────────────────────────────────

export interface Interval { start: number; end: number }

/** Intervalle d'une période : sans heure, la période couvre les journées entières (de 00:00 du 1er jour à 24:00 du dernier). */
export function intervalOf(startDate: Date, startTime: string | null, endDate: Date, endTime: string | null): Interval {
  return { start: epochMinutes(startDate) + (startTime ? toMinutes(startTime) : 0), end: epochMinutes(endDate) + (endTime ? toMinutes(endTime) : DAY_MINUTES) };
}

/** Deux intervalles se chevauchent si l'un commence avant la fin de l'autre ; deux périodes qui se touchent (fin = début) ne se chevauchent pas. */
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

// ── Retards ────────────────────────────────────────────────────

/**
 * Minutes de retard : écart entre l'heure réelle d'arrivée et l'heure prévue. Un écart inférieur ou égal à la tolérance configurée
 * n'est pas un retard (0). Au-delà, le retard compte en entier (la tolérance n'est pas déduite).
 */
export function lateMinutes(expected: string, actual: string, graceMinutes = 0): number {
  const diff = toMinutes(actual) - toMinutes(expected);
  return diff > Math.max(0, graceMinutes) ? diff : 0;
}

/** Durée lisible : 95 → « 1 h 35 », 45 → « 45 min ». */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
