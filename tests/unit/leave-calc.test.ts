import { describe, expect, it } from "vitest";
import { accruedAt, annualEntitlement, computeBalance, DEFAULT_CALENDAR, easterSunday, holidaysFor, isoDay, workingDays, type LeaveRow, type LeaveRule, type WorkCalendar } from "@/modules/hr/leave-calc";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const cal = (holidays: string[], workDays = [1, 2, 3, 4, 5]): WorkCalendar => ({ workDays: new Set(workDays), holidays: new Set(holidays) });

describe("jours travaillés", () => {
  it("sans calendrier : lundi au vendredi", () => {
    expect(workingDays(d("2027-03-01"), d("2027-03-05"), DEFAULT_CALENDAR)).toBe(5);
    expect(workingDays(d("2027-03-05"), d("2027-03-08"))).toBe(2);
    expect(workingDays(d("2027-03-06"), d("2027-03-07"))).toBe(0);
  });

  it("un jour férié n'est pas décompté, et un férié de week-end ne l'est pas deux fois", () => {
    // 1er mai 2026 = vendredi
    expect(workingDays(d("2026-04-27"), d("2026-05-01"), cal(["2026-05-01"]))).toBe(4);
    // 25 décembre 2027 = samedi : aucun effet
    expect(workingDays(d("2027-12-20"), d("2027-12-26"), cal(["2027-12-25"]))).toBe(5);
  });

  it("une semaine du lundi au samedi compte six jours ; un calendrier à jours fériés cumulés se décompte jour par jour", () => {
    expect(workingDays(d("2027-03-01"), d("2027-03-06"), cal([], [1, 2, 3, 4, 5, 6]))).toBe(6);
    expect(workingDays(d("2027-03-01"), d("2027-03-06"), cal(["2027-03-03", "2027-03-04"], [1, 2, 3, 4, 5, 6]))).toBe(4);
  });
});

describe("jours fériés", () => {
  it("calcule la date de Pâques", () => {
    expect(isoDay(easterSunday(2025))).toBe("2025-04-20");
    expect(isoDay(easterSunday(2026))).toBe("2026-04-05");
    expect(isoDay(easterSunday(2027))).toBe("2027-03-28");
    expect(isoDay(easterSunday(2038))).toBe("2038-04-25");
  });

  it("Côte d'Ivoire : dates fixes et fêtes liées à Pâques", () => {
    const h = Object.fromEntries(holidaysFor("CI", 2026).map((x) => [x.name, x.date]));
    expect(h["Jour de l'An"]).toBe("2026-01-01");
    expect(h["Lundi de Pâques"]).toBe("2026-04-06");
    expect(h["Ascension"]).toBe("2026-05-14");
    expect(h["Lundi de Pentecôte"]).toBe("2026-05-25");
    expect(h["Fête de l'Indépendance"]).toBe("2026-08-07");
    expect(h["Journée nationale de la Paix"]).toBe("2026-11-15");
    expect(holidaysFor("CI", 2026)).toHaveLength(10);
    // triés par date
    const dates = holidaysFor("CI", 2027).map((x) => x.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("Sénégal, et repli sur les fêtes communes pour un pays non géré", () => {
    expect(holidaysFor("SN", 2026).some((x) => x.date === "2026-04-04")).toBe(true);
    expect(holidaysFor("ZZ", 2026).map((x) => x.date)).toEqual(["2026-01-01", "2026-05-01", "2026-12-25"]);
  });
});

const rule = (over: Partial<LeaveRule> = {}): LeaveRule => ({ annualDays: 22, accrual: "UPFRONT", carryOverMax: 0, carryOverExpiryMonth: null, ...over });
const veteran = { hireDate: d("2018-01-01"), endDate: null };

describe("droit annuel et acquisition", () => {
  it("plein droit pour un salarié présent toute l'année ; proratisé l'année d'arrivée et de départ (demi-jour le plus proche)", () => {
    expect(annualEntitlement(rule(), veteran, 2026)).toBe(22);
    expect(annualEntitlement(rule({ annualDays: 24 }), { hireDate: d("2026-07-01"), endDate: null }, 2026)).toBe(12); // 184/365
    expect(annualEntitlement(rule(), { hireDate: d("2018-01-01"), endDate: d("2026-06-30") }, 2026)).toBe(11); // 181/365
    expect(annualEntitlement(rule(), { hireDate: d("2027-01-01"), endDate: null }, 2026)).toBe(0); // pas encore arrivé
    expect(annualEntitlement(rule({ annualDays: 0 }), veteran, 2026)).toBe(0); // type non plafonné
  });

  it("acquisition à l'avance : tout le droit dès le départ ; progressive : constitué jour après jour, arrondi par défaut", () => {
    expect(accruedAt(rule({ annualDays: 24 }), veteran, 2026, d("2026-01-31"))).toBe(24);
    const monthly = rule({ annualDays: 24, accrual: "MONTHLY" });
    expect(accruedAt(monthly, veteran, 2026, d("2026-03-31"))).toBe(5.5); // 24 × 90/365 = 5,92 → 5,5
    expect(accruedAt(monthly, veteran, 2026, d("2026-06-30"))).toBe(11.5); // 24 × 181/365 = 11,9 → 11,5
    expect(accruedAt(monthly, veteran, 2026, d("2026-12-31"))).toBe(24);
    expect(accruedAt(monthly, { hireDate: d("2026-07-01"), endDate: null }, 2026, d("2026-06-30"))).toBe(0);
  });
});

const row = (year: number, days: number, end: string, status: LeaveRow["status"] = "APPROVED"): LeaveRow => ({ year, days, endDate: d(end), status });
const newcomer = { hireDate: d("2025-01-01"), endDate: null };

describe("soldes et report", () => {
  it("solde simple : droit − pris − en attente", () => {
    const b = computeBalance(rule(), veteran, 2026, d("2026-06-01"), [row(2026, 5, "2026-03-05"), row(2026, 3, "2026-05-08", "PENDING")]);
    expect(b).toMatchObject({ entitlement: 22, carryOver: 0, taken: 5, pending: 3, remaining: 14, available: 14 });
  });

  it("report : reliquat de l'année précédente, plafonné, utilisé AVANT le droit de l'année", () => {
    const r = rule({ carryOverMax: 5 });
    // 2025 : 22 − 10 pris = 12 de reliquat → plafonné à 5 jours reportés
    const none = computeBalance(r, newcomer, 2026, d("2026-06-01"), [row(2025, 10, "2025-08-01")]);
    expect(none.carryOver).toBe(5);
    expect(none.remaining).toBe(27);
    // 8 jours pris en 2026 : 5 viennent du report, 3 du droit de l'année
    const used = computeBalance(r, newcomer, 2026, d("2026-06-01"), [row(2025, 10, "2025-08-01"), row(2026, 8, "2026-02-27")]);
    expect(used.remaining).toBe(19);
    // report plus petit que le plafond : tout le reliquat
    const small = computeBalance(r, newcomer, 2026, d("2026-06-01"), [row(2025, 20, "2025-08-01")]);
    expect(small.carryOver).toBe(2);
    // consommé au-delà du droit : plus de report
    const over = computeBalance(r, newcomer, 2026, d("2026-06-01"), [row(2025, 25 - 3, "2025-12-01")]);
    expect(over.carryOver).toBe(0);
  });

  it("pas de report sans plafond, ni l'année d'arrivée", () => {
    expect(computeBalance(rule(), newcomer, 2026, d("2026-06-01"), []).carryOver).toBe(0);
    expect(computeBalance(rule({ carryOverMax: 5 }), newcomer, 2025, d("2025-06-01"), []).carryOver).toBe(0);
  });

  it("le report enchaîne d'année en année, dans la limite du plafond", () => {
    const r = rule({ carryOverMax: 5 });
    // 2025 : rien pris → report 5 en 2026 ; 2026 : rien pris → reliquat 22 + 5 → report plafonné à 5 en 2027
    const b = computeBalance(r, newcomer, 2027, d("2027-02-01"), []);
    expect(b.carryOver).toBe(5);
  });

  it("report avec échéance : utilisable jusqu'à la fin du mois indiqué, perdu ensuite", () => {
    const r = rule({ carryOverMax: 5, carryOverExpiryMonth: 3 });
    const rows = [row(2025, 10, "2025-08-01"), row(2026, 2, "2026-02-15")]; // 2 jours pris avant l'échéance
    const before = computeBalance(r, newcomer, 2026, d("2026-02-20"), rows);
    expect(before.carryOver).toBe(5);
    expect(before.carryExpiresOn && isoDay(before.carryExpiresOn)).toBe("2026-03-31");
    expect(before.available).toBe(25); // 22 + 3 de report restant
    const after = computeBalance(r, newcomer, 2026, d("2026-04-10"), rows);
    expect(after.available).toBe(22); // report expiré
    expect(after.remaining).toBe(22);
  });

  it("report avec échéance : un reliquat de report non pris est perdu aussi dans le calcul de l'année suivante", () => {
    const r = rule({ carryOverMax: 5, carryOverExpiryMonth: 3 });
    // 2026 : report de 5 non utilisé avant fin mars, 4 jours pris en juin → seul le droit est entamé : reliquat 22 − 4 = 18 → report plafonné à 5
    const b = computeBalance(r, newcomer, 2027, d("2027-01-15"), [row(2025, 10, "2025-08-01"), row(2026, 4, "2026-06-10")]);
    expect(b.carryOver).toBe(5);
  });

  it("acquisition progressive : on ne peut poser que le constitué à la fin de la période, report compris", () => {
    const r = rule({ annualDays: 24, accrual: "MONTHLY" });
    expect(computeBalance(r, veteran, 2026, d("2026-03-31"), []).available).toBe(5.5);
    expect(computeBalance(r, veteran, 2026, d("2026-03-31"), [row(2026, 3, "2026-02-27", "PENDING")]).available).toBe(2.5);
    expect(computeBalance(r, veteran, 2026, d("2026-12-31"), []).available).toBe(24);
  });
});
