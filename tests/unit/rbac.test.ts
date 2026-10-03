import { describe, expect, it } from "vitest";
import { MODULES } from "@/core/modules/registry";
import { buildAccess, can, canAll, canAny, effectivePermissions, hasModule } from "@/core/rbac/access";
import { PERMISSIONS, PERMISSION_BY_KEY, ROLE_TEMPLATES, expandPatterns } from "@/core/rbac/catalog";

describe("catalogue de permissions", () => {
  it("contient les clés de référence du cahier des charges", () => {
    for (const key of [
      "finance.invoice.read", "finance.invoice.create", "finance.invoice.update", "finance.invoice.delete",
      "finance.payment.validate", "crm.customer.read", "crm.customer.create", "hr.employee.read",
      "hr.payroll.manage", "inventory.stock.read", "inventory.stock.adjust", "fleet.vehicle.manage",
      "project.task.manage",
    ]) {
      expect(PERMISSION_BY_KEY.has(key), key).toBe(true);
    }
  });

  it("rattache chaque permission à un module existant", () => {
    const modules = new Set<string>(MODULES.map((m) => m.key));
    for (const p of PERMISSIONS) expect(modules.has(p.module), p.key).toBe(true);
  });

  it("les motifs des gabarits produisent des permissions et aucun motif n'est mort", () => {
    for (const tpl of ROLE_TEMPLATES) {
      for (const pat of tpl.patterns) {
        expect(expandPatterns([pat]).length, `${tpl.key}: ${pat}`).toBeGreaterThan(0);
      }
    }
  });

  it("le rôle Consultation n'accorde que des lectures", () => {
    const viewer = ROLE_TEMPLATES.find((t) => t.key === "viewer")!;
    expect(expandPatterns(viewer.patterns).every((k) => k.endsWith(".read"))).toBe(true);
  });
});

describe("résolution d'accès (rôle ∩ modules)", () => {
  const sales = buildAccess({
    isAdmin: false,
    grantedKeys: ["finance.invoice.read", "inventory.stock.read", "crm.customer.read"],
    enabledModules: ["sales", "crm"], // « inventory » non activé
  });

  it("accorde si permission ET module actif", () => {
    expect(can(sales, "finance.invoice.read")).toBe(true); // module sales
    expect(can(sales, "crm.customer.read")).toBe(true);
  });

  it("refuse si le module est désactivé, même avec la permission (Stock désactivé)", () => {
    expect(can(sales, "inventory.stock.read")).toBe(false);
    expect(hasModule(sales, "inventory")).toBe(false);
  });

  it("refuse une permission non accordée ou inconnue", () => {
    expect(can(sales, "finance.invoice.delete")).toBe(false);
    expect(can(sales, "n.existe.pas")).toBe(false);
  });

  it("l'administrateur a tout… mais seulement dans les modules actifs", () => {
    const admin = buildAccess({ isAdmin: true, grantedKeys: [], enabledModules: ["finance"] });
    expect(can(admin, "finance.expense.delete")).toBe(true);
    expect(can(admin, "settings.company.update")).toBe(true); // cœur
    expect(can(admin, "inventory.stock.adjust")).toBe(false); // module off
    expect(effectivePermissions(admin).every((k) => PERMISSION_BY_KEY.get(k)!.module === "finance" || PERMISSION_BY_KEY.get(k)!.module === "core")).toBe(true);
  });

  it("le cœur est toujours actif", () => {
    const none = buildAccess({ isAdmin: false, grantedKeys: ["dashboard.dashboard.read"], enabledModules: [] });
    expect(can(none, "dashboard.dashboard.read")).toBe(true);
  });

  it("canAny / canAll", () => {
    expect(canAny(sales, ["finance.invoice.delete", "crm.customer.read"])).toBe(true);
    expect(canAll(sales, ["finance.invoice.read", "finance.invoice.delete"])).toBe(false);
  });
});
