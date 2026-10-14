/**
 * Calendrier de travail et calcul des droits à congés — fonctions PURES (aucun accès base), donc testables et rejouables.
 *
 * Règles (toutes explicites, aucune n'est cachée dans un taux légal) :
 *  - un jour compte s'il tombe un jour travaillé de la semaine (par défaut lundi-vendredi) ET n'est pas un jour férié de l'entreprise ;
 *  - le droit annuel d'un salarié arrivé ou parti en cours d'année est proratisé aux jours de présence, arrondi au demi-jour le plus proche ;
 *  - acquisition « progressive » : le droit se constitue jour après jour (arrondi au demi-jour INFÉRIEUR : on n'accorde jamais plus que l'acquis) ;
 *  - report : les jours non pris au 31 décembre passent à l'année suivante dans la limite du plafond du type ; ils peuvent expirer à la fin
 *    d'un mois donné, et sont consommés AVANT le droit de l'année (premier arrivé, premier consommé).
 */
const DAY = 86_400_000;
export const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5];

export interface WorkCalendar { workDays: ReadonlySet<number>; holidays: ReadonlySet<string> }
export const DEFAULT_CALENDAR: WorkCalendar = { workDays: new Set(DEFAULT_WORK_DAYS), holidays: new Set() };

const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
export const isoDay = (v: Date) => v.toISOString().slice(0, 10);
const utc = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));
const addDays = (v: Date, n: number) => new Date(v.getTime() + n * DAY);
const daysInYear = (y: number) => (utc(y + 1, 0, 1).getTime() - utc(y, 0, 1).getTime()) / DAY;

/** Jours travaillés entre deux dates incluses : hors jours non travaillés de la semaine et hors jours fériés. */
export function workingDays(start: Date, end: Date, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  let n = 0;
  for (let t = day(start).getTime(); t <= day(end).getTime(); t += DAY) {
    const dt = new Date(t);
    if (cal.workDays.has(dt.getUTCDay()) && !cal.holidays.has(isoDay(dt))) n++;
  }
  return n;
}

// ── Jours fériés ───────────────────────────────────────────────

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month - 1, dayOfMonth);
}

export interface HolidayDef { date: string; name: string }
type Rule = { name: string } & ({ fixed: [number, number] } | { easter: number });

const NEW_YEAR: Rule = { name: "Jour de l'An", fixed: [1, 1] };
const LABOUR: Rule = { name: "Fête du Travail", fixed: [5, 1] };
const CHRISTMAS: Rule = { name: "Noël", fixed: [12, 25] };
const EASTER_MONDAY: Rule = { name: "Lundi de Pâques", easter: 1 };
const ASCENSION: Rule = { name: "Ascension", easter: 39 };
const WHIT_MONDAY: Rule = { name: "Lundi de Pentecôte", easter: 50 };
const ASSUMPTION: Rule = { name: "Assomption", fixed: [8, 15] };
const ALL_SAINTS: Rule = { name: "Toussaint", fixed: [11, 1] };

/**
 * Jours fériés CALCULABLES par pays : dates fixes et fêtes liées à Pâques. Les fêtes musulmanes (Aïd el-Fitr, Tabaski, Mouloud, etc.)
 * dépendent de l'observation de la lune et d'un décret : elles ne sont PAS générées, l'entreprise les ajoute chaque année.
 * Les dates officielles peuvent changer par décret : vérifiez la liste avant de l'adopter.
 */
export const HOLIDAY_RULES: Record<string, { label: string; rules: Rule[] }> = {
  CI: { label: "Côte d'Ivoire", rules: [NEW_YEAR, EASTER_MONDAY, LABOUR, ASCENSION, WHIT_MONDAY, { name: "Fête de l'Indépendance", fixed: [8, 7] }, ASSUMPTION, ALL_SAINTS, { name: "Journée nationale de la Paix", fixed: [11, 15] }, CHRISTMAS] },
  SN: { label: "Sénégal", rules: [NEW_YEAR, EASTER_MONDAY, { name: "Fête de l'Indépendance", fixed: [4, 4] }, LABOUR, ASCENSION, WHIT_MONDAY, ASSUMPTION, ALL_SAINTS, CHRISTMAS] },
  COMMON: { label: "Autre pays (fêtes communes à compléter)", rules: [NEW_YEAR, LABOUR, CHRISTMAS] },
};

export function holidaysFor(country: string, year: number): HolidayDef[] {
  const def = HOLIDAY_RULES[country] ?? HOLIDAY_RULES.COMMON!;
  const easter = easterSunday(year);
  return def.rules
    .map((r) => ({ date: isoDay("fixed" in r ? utc(year, r.fixed[0] - 1, r.fixed[1]) : addDays(easter, r.easter)), name: r.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Droits à congés ────────────────────────────────────────────

export interface LeaveRule { annualDays: number; accrual: "UPFRONT" | "MONTHLY"; carryOverMax: number; carryOverExpiryMonth: number | null }
export interface Service { hireDate: Date; endDate: Date | null }
export interface LeaveRow { year: number; status: "APPROVED" | "PENDING"; days: number; endDate: Date }

const round05 = (x: number) => Math.round(x * 2) / 2;
const floor05 = (x: number) => Math.floor(x * 2 + 1e-9) / 2;

/** Jours de présence dans l'année `year`, jusqu'à `until` (inclus) si fourni. */
function serviceDays(svc: Service, year: number, until?: Date): number {
  const from = Math.max(day(svc.hireDate).getTime(), utc(year, 0, 1).getTime());
  let to = utc(year, 11, 31).getTime();
  if (svc.endDate) to = Math.min(to, day(svc.endDate).getTime());
  if (until) to = Math.min(to, day(until).getTime());
  return to < from ? 0 : (to - from) / DAY + 1;
}

/** Droit annuel de l'année (proratisé à la présence). */
export function annualEntitlement(rule: LeaveRule, svc: Service, year: number): number {
  if (rule.annualDays <= 0) return 0;
  return round05((rule.annualDays * serviceDays(svc, year)) / daysInYear(year));
}

/** Droit acquis à la date `asOf` : tout le droit annuel (acquisition à l'avance) ou la part constituée à cette date (acquisition progressive). */
export function accruedAt(rule: LeaveRule, svc: Service, year: number, asOf: Date): number {
  const full = annualEntitlement(rule, svc, year);
  if (rule.accrual === "UPFRONT") return full;
  return Math.min(full, floor05((rule.annualDays * serviceDays(svc, year, asOf)) / daysInYear(year)));
}

const expiryOf = (rule: LeaveRule, year: number) => (rule.carryOverExpiryMonth ? utc(year, rule.carryOverExpiryMonth, 0) : null); // dernier jour du mois

export interface Balance {
  /** Droit annuel (proratisé). */
  entitlement: number;
  /** Droit constitué à la date demandée (= droit annuel en acquisition anticipée). */
  accrued: number;
  /** Jours reportés de l'année précédente. */
  carryOver: number;
  /** Dernier jour d'utilisation des jours reportés, s'ils expirent. */
  carryExpiresOn: Date | null;
  taken: number;
  pending: number;
  /** Solde annuel à la date demandée : droit annuel + report encore valable − pris − en attente. */
  remaining: number;
  /** Solde utilisable pour une période se terminant à `asOf` : constitué à cette date + report encore valable − pris − en attente. */
  available: number;
}

/** Jours reportés vers `year` : reliquat de l'année précédente (récursif, plafonné) — voir l'en-tête du fichier. */
function carryInto(rule: LeaveRule, svc: Service, year: number, rows: LeaveRow[]): number {
  if (rule.carryOverMax <= 0 || rule.annualDays <= 0) return 0;
  if (year <= day(svc.hireDate).getUTCFullYear()) return 0;
  const prev = year - 1;
  const used = rows.filter((r) => r.year === prev);
  const takenPrev = used.reduce((a, r) => a + r.days, 0);
  const carryPrev = carryInto(rule, svc, prev, rows);
  const expiry = expiryOf(rule, prev);
  const beforeExpiry = expiry ? used.filter((r) => r.endDate <= expiry).reduce((a, r) => a + r.days, 0) : takenPrev;
  const carryUsed = Math.min(carryPrev, beforeExpiry);
  const leftoverCarry = expiry ? 0 : carryPrev - carryUsed; // sans échéance, le report non utilisé reste dû ; avec échéance, il est perdu
  const unused = Math.max(0, annualEntitlement(rule, svc, prev) - Math.max(0, takenPrev - carryUsed)) + leftoverCarry;
  return Math.min(rule.carryOverMax, unused);
}

/** Solde d'un salarié pour un type de congé. `rows` : demandes approuvées ou en attente des années utiles (au moins l'année demandée et les cinq précédentes). */
export function computeBalance(rule: LeaveRule, svc: Service, year: number, asOf: Date, rows: LeaveRow[]): Balance {
  const entitlement = annualEntitlement(rule, svc, year);
  const accrued = accruedAt(rule, svc, year, asOf);
  const carryOver = carryInto(rule, svc, year, rows);
  const expiry = expiryOf(rule, year);
  const mine = rows.filter((r) => r.year === year);
  const taken = mine.filter((r) => r.status === "APPROVED").reduce((a, r) => a + r.days, 0);
  const pending = mine.filter((r) => r.status === "PENDING").reduce((a, r) => a + r.days, 0);
  const booked = taken + pending;
  const beforeExpiry = expiry ? mine.filter((r) => r.endDate <= expiry).reduce((a, r) => a + r.days, 0) : booked;
  const carryUsed = Math.min(carryOver, beforeExpiry);
  const carryLeft = carryOver - carryUsed;
  const fromEntitlement = Math.max(0, booked - carryUsed);
  const carryUsable = expiry && day(asOf) > expiry ? 0 : carryLeft;
  return {
    entitlement, accrued, carryOver, carryExpiresOn: carryOver > 0 ? expiry : null, taken, pending,
    remaining: entitlement - fromEntitlement + carryUsable,
    available: accrued - fromEntitlement + carryUsable,
  };
}
