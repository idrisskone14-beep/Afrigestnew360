import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR, type WorkCalendar } from "@/modules/hr/leave-calc";
import { DEFAULT_SCHEDULE, formatMinutes, hoursOf, intervalOf, lateMinutes, overlaps, parseDay, toMinutes, workMinutesBetween, workWindows } from "@/modules/hr/time";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const cal = (holidays: string[] = [], workDays = [1, 2, 3, 4, 5]): WorkCalendar => ({ workDays: new Set(workDays), holidays: new Set(holidays) });
const lunch = { ...DEFAULT_SCHEDULE, breakStart: "12:00", breakEnd: "13:00" };

describe("heures et dates", () => {
  it("convertit les heures et refuse les valeurs invalides", () => {
    expect(toMinutes("08:30")).toBe(510);
    expect(() => toMinutes("24:00")).toThrow();
    expect(() => toMinutes("8:30")).toThrow();
    expect(parseDay("2027-02-29")).toBeNull(); // 2027 n'est pas bissextile
    expect(parseDay("2028-02-29")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(parseDay("")).toBeNull();
  });
  it("formate les durées", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(95)).toBe("1 h 35");
    expect(formatMinutes(120)).toBe("2 h");
  });
});

describe("heures de travail d'une permission horaire", () => {
  it("une plage dans la journée compte telle quelle", () => {
    expect(workMinutesBetween(d("2027-03-01"), "09:00", d("2027-03-01"), "11:30", DEFAULT_SCHEDULE, cal())).toBe(150);
  });
  it("la pause déjeuner n'est pas décomptée", () => {
    expect(workMinutesBetween(d("2027-03-01"), "11:00", d("2027-03-01"), "14:00", lunch, cal())).toBe(120); // 11-12 + 13-14
    expect(workWindows(lunch)).toEqual([[480, 720], [780, 1020]]);
  });
  it("à cheval sur deux journées : fin de la 1re + début de la 2e, la nuit ne compte pas", () => {
    // lundi 16:00 → mardi 10:00 : 16-17 (60) + 08-10 (120)
    expect(workMinutesBetween(d("2027-03-01"), "16:00", d("2027-03-02"), "10:00", DEFAULT_SCHEDULE, cal())).toBe(180);
  });
  it("à cheval sur le week-end ou un jour férié : seuls les jours travaillés comptent", () => {
    // vendredi 16:00 → lundi 09:00 : 60 + 60
    expect(workMinutesBetween(d("2027-03-05"), "16:00", d("2027-03-08"), "09:00", DEFAULT_SCHEDULE, cal())).toBe(120);
    // mardi férié : lundi 16:00 → mercredi 09:00 = 60 + 60
    expect(workMinutesBetween(d("2027-03-01"), "16:00", d("2027-03-03"), "09:00", DEFAULT_SCHEDULE, cal(["2027-03-02"]))).toBe(120);
  });
  it("hors horaire de référence : zéro", () => {
    expect(workMinutesBetween(d("2027-03-01"), "18:00", d("2027-03-01"), "20:00", DEFAULT_SCHEDULE, cal())).toBe(0);
    expect(workMinutesBetween(d("2027-03-06"), "09:00", d("2027-03-06"), "11:00", DEFAULT_SCHEDULE, DEFAULT_CALENDAR)).toBe(0); // samedi
    expect(hoursOf(150)).toBe(2.5);
  });
  it("un horaire invalide est refusé", () => {
    expect(() => workWindows({ ...DEFAULT_SCHEDULE, start: "17:00", end: "08:00" })).toThrow();
  });
});

describe("chevauchements", () => {
  it("deux plages horaires du même jour : compatibles si elles ne se recouvrent pas, y compris quand elles se touchent", () => {
    const a = intervalOf(d("2027-03-01"), "08:00", d("2027-03-01"), "10:00");
    expect(overlaps(a, intervalOf(d("2027-03-01"), "10:00", d("2027-03-01"), "12:00"))).toBe(false);
    expect(overlaps(a, intervalOf(d("2027-03-01"), "09:59", d("2027-03-01"), "12:00"))).toBe(true);
  });
  it("une période sans heure couvre les journées entières", () => {
    const leave = intervalOf(d("2027-03-01"), null, d("2027-03-03"), null);
    expect(overlaps(leave, intervalOf(d("2027-03-03"), "16:00", d("2027-03-03"), "17:00"))).toBe(true);
    expect(overlaps(leave, intervalOf(d("2027-03-04"), "08:00", d("2027-03-04"), "09:00"))).toBe(false);
  });
  it("une permission à cheval sur deux journées chevauche le lendemain", () => {
    const night = intervalOf(d("2027-03-01"), "22:00", d("2027-03-02"), "06:00");
    expect(overlaps(night, intervalOf(d("2027-03-02"), "05:00", d("2027-03-02"), "07:00"))).toBe(true);
    expect(overlaps(night, intervalOf(d("2027-03-02"), "06:00", d("2027-03-02"), "07:00"))).toBe(false);
  });
});

describe("retards", () => {
  it("écart entre l'heure réelle et l'heure prévue", () => {
    expect(lateMinutes("08:00", "08:25")).toBe(25);
    expect(lateMinutes("08:00", "07:50")).toBe(0);
    expect(lateMinutes("08:00", "08:00")).toBe(0);
  });
  it("la tolérance exclut le retard, mais n'est pas déduite au-delà", () => {
    expect(lateMinutes("08:00", "08:10", 10)).toBe(0);
    expect(lateMinutes("08:00", "08:11", 10)).toBe(11);
  });
});
