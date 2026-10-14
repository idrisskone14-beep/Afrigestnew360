import { describe, expect, it } from "vitest";
import { absencePeak, ageBrackets, averageTenureYears, headcountAt, isPresentAt, monthlyMovements, pct, spreadLeaveDays, turnoverRate, type Person } from "@/modules/hr/hr-metrics";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const p = (hire: string, end: string | null = null, birth: string | null = null): Person => ({ hireDate: d(hire), endDate: end ? d(end) : null, birthDate: birth ? d(birth) : null });

describe("effectif", () => {
  it("un salarié compte du jour d'arrivée au jour de départ inclus", () => {
    const x = p("2026-03-10", "2026-06-30");
    expect(isPresentAt(x, d("2026-03-09"))).toBe(false);
    expect(isPresentAt(x, d("2026-03-10"))).toBe(true);
    expect(isPresentAt(x, d("2026-06-30"))).toBe(true);
    expect(isPresentAt(x, d("2026-07-01"))).toBe(false);
  });

  it("mouvements mensuels : effectif de fin de mois, arrivées, départs ; mois à venir figés à la date de référence", () => {
    const rows = [p("2020-01-01"), p("2025-06-01"), p("2026-02-10"), p("2026-04-05", "2026-05-20"), p("2024-01-01", "2026-03-15")];
    const m = monthlyMovements(rows, 2026, d("2026-06-15"));
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ month: "2026-01", headcount: 3, entries: 0, exits: 0 }); // 2020, 2025, 2024
    expect(m[1]).toMatchObject({ month: "2026-02", headcount: 4, entries: 1, exits: 0 });
    expect(m[2]).toMatchObject({ month: "2026-03", headcount: 3, entries: 0, exits: 1 }); // départ du 15 mars
    expect(m[4]).toMatchObject({ month: "2026-05", headcount: 3, entries: 0, exits: 1 }); // arrivée d'avril partie le 20 mai
    expect(m[5]).toMatchObject({ month: "2026-06", headcount: 3 }); // 15 juin : date de référence
    expect(m[8]).toMatchObject({ entries: 0, exits: 0, headcount: 3 });
    expect(headcountAt(rows, d("2026-06-15"))).toBe(3);
  });

  it("taux de rotation : départs ÷ effectif moyen", () => {
    expect(turnoverRate(3, 40, 50)).toBe(6.7); // 3 / 45
    expect(turnoverRate(0, 10, 10)).toBe(0);
    expect(turnoverRate(2, 0, 0)).toBeNull();
  });

  it("ancienneté moyenne et pyramide des âges des salariés présents", () => {
    const rows = [p("2016-01-01", null, "1990-05-20"), p("2024-01-01", null, "2003-03-01"), p("2020-01-01", "2021-01-01", "1970-01-01"), p("2022-01-01", null, null), p("2010-01-01", null, "1968-12-31")];
    expect(averageTenureYears(rows, d("2026-01-01"))).toBe(8); // (10 + 2 + 4 + 16) / 4
    const brackets = ageBrackets(rows, d("2026-01-01"));
    expect(brackets.find((b) => b.label === "Moins de 25 ans")!.count).toBe(1); // né en 2003
    expect(brackets.find((b) => b.label === "35 à 44 ans")!.count).toBe(1); // né en 1990 : 35 ans
    expect(brackets.find((b) => b.label === "55 ans et plus")!.count).toBe(1);
    expect(brackets.find((b) => b.label === "Non renseigné")!.count).toBe(1);
    expect(brackets.reduce((a, b) => a + b.count, 0)).toBe(4); // le salarié parti n'est pas compté
    expect(averageTenureYears([], d("2026-01-01"))).toBeNull();
  });

  it("l'âge tient compte de l'anniversaire", () => {
    const rows = [p("2020-01-01", null, "2001-06-15")];
    expect(ageBrackets(rows, d("2026-06-14"))[0]!.count).toBe(1); // 24 ans la veille de l'anniversaire
    expect(ageBrackets(rows, d("2026-06-15"))[1]!.count).toBe(1); // 25 ans
  });
});

describe("pourcentages et congés", () => {
  it("pct : une décimale, null sans dénominateur", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 10)).toBe(0);
    expect(pct(5, 0)).toBeNull();
  });

  it("répartit les jours d'un congé entre les mois au prorata des jours calendaires", () => {
    // 28 janvier → 6 février : 10 jours calendaires (4 en janvier, 6 en février), 8 jours ouvrés
    const out = spreadLeaveDays([{ startDate: d("2026-01-28"), endDate: d("2026-02-06"), days: 8 }], 2026);
    expect(out[0]).toBe(3.2);
    expect(out[1]).toBe(4.8);
    expect(out.reduce((a, v) => a + v, 0)).toBeCloseTo(8, 5);
    // une demande hors année n'apporte rien
    expect(spreadLeaveDays([{ startDate: d("2025-12-01"), endDate: d("2025-12-05"), days: 5 }], 2026).every((v) => v === 0)).toBe(true);
  });

  it("pic d'absence : plus grand nombre d'absents le même jour", () => {
    expect(absencePeak(new Map())).toEqual({ max: 0, dates: [] });
    expect(absencePeak(new Map([["2026-03-02", 2], ["2026-03-03", 4], ["2026-03-04", 4]]))).toEqual({ max: 4, dates: ["2026-03-03", "2026-03-04"] });
  });
});
