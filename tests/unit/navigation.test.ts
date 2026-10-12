import { describe, expect, it } from "vitest";
import { MODULES } from "@/core/modules/registry";
import { FAMILIES, familyOfModule, moduleItems } from "@/core/tenant/module-nav";
import { dateRangeParam, pageSizeOf, PAGE_SIZE } from "@/lib/list-params";
import { yearOptions, yearRange } from "@/lib/period";

const canOnly = (...keys: string[]) => ({ can: (k: string) => keys.includes(k) });

describe("navigation : sous-menus par module", () => {
  it("n'affiche que les pages que l'utilisateur peut ouvrir", () => {
    const labels = moduleItems(canOnly("sales.quote.read", "finance.invoice.read"), "sales").map((i) => i.label);
    expect(labels).toEqual(["Vue d'ensemble", "Devis clients", "Factures de vente", "Relances"]);
    expect(moduleItems(canOnly(), "sales").map((i) => i.label)).toEqual(["Vue d'ensemble"]);
  });

  it("la paie distingue gestionnaire et salarié", () => {
    expect(moduleItems(canOnly("hr.payroll.manage"), "payroll").map((i) => i.label)).toEqual(["Campagnes", "Bulletins", "Rubriques"]);
    expect(moduleItems(canOnly("hr.payslip.read"), "payroll").map((i) => i.label)).toEqual(["Mes bulletins"]);
  });

  it("un module sans sous-menu renvoie une liste vide", () => {
    expect(moduleItems(canOnly(), "documents")).toEqual([]);
  });

  it("chaque module disponible appartient à une famille du rail, une seule fois", () => {
    const placed = FAMILIES.flatMap((f) => [...f.modules]);
    expect(new Set(placed).size).toBe(placed.length);
    for (const m of MODULES.filter((x) => x.kind !== "CORE")) expect(familyOfModule(m.key), m.key).toBeDefined();
  });
});

describe("listes : lignes par page et périodes", () => {
  it("ne retient que les tailles de page proposées", () => {
    expect(pageSizeOf({ lignes: "50" })).toBe(50);
    expect(pageSizeOf({ lignes: "7" })).toBe(PAGE_SIZE);
    expect(pageSizeOf({})).toBe(PAGE_SIZE);
  });

  it("lit un intervalle de dates et ignore les valeurs invalides", () => {
    const r = dateRangeParam({ emission_du: "2026-08-01", emission_au: "2026-08-31" }, "emission");
    expect(r.gte?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(r.lt?.toISOString()).toBe("2026-09-01T00:00:00.000Z"); // « au » inclus
    expect(dateRangeParam({ emission_du: "n'importe quoi", emission_au: "2026-13-45" }, "emission")).toEqual({});
  });

  it("l'année choisie couvre du 1er janvier au 31 décembre", () => {
    const { gte, lt } = yearRange(2026);
    expect(gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("les années proposées incluent l'année suivante et l'année choisie, sans doublon", () => {
    const now = new Date().getFullYear();
    const years = yearOptions(now - 9);
    expect(years[0]).toBe(now + 1);
    expect(years).toContain(now - 9);
    expect(new Set(years).size).toBe(years.length);
  });
});
