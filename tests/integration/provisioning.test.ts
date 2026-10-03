import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { getEffectiveLimits, assertWithinLimit, getUsage } from "@/core/modules/limits";
import { MODULES } from "@/core/modules/registry";
import { ROLE_TEMPLATES } from "@/core/rbac/catalog";
import { applyPlanModules } from "@/core/tenant/provisioning";
import { makeCompany } from "../helpers";

const enabledKeys = async (companyId: string) =>
  (await platformDb.companyModule.findMany({ where: { companyId, enabled: true }, include: { module: true } })).map((m) => m.module.key);

describe("provisionCompany", () => {
  it("crée rôles, abonnement, modules, siège et membership propriétaire", async () => {
    const { company, owner, adminRoleId } = await makeCompany("Prov", "business");
    const roles = await platformDb.role.findMany({ where: { companyId: company.id } });
    expect(roles).toHaveLength(ROLE_TEMPLATES.length);
    expect(roles.find((r) => r.id === adminRoleId)?.isAdmin).toBe(true);

    const comptable = roles.find((r) => r.templateKey === "accountant")!;
    const perms = await platformDb.rolePermission.findMany({ where: { roleId: comptable.id }, include: { permission: true } });
    expect(perms.map((p) => p.permission.key)).toContain("finance.payment.validate");
    expect(perms.map((p) => p.permission.key)).not.toContain("hr.payroll.manage");

    const sub = await platformDb.subscription.findUniqueOrThrow({ where: { companyId: company.id } });
    expect(sub.status).toBe("TRIALING");

    const m = await platformDb.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId: owner.id, companyId: company.id } } });
    expect(m.isOwner).toBe(true);
    expect(m.roleId).toBe(adminRoleId);

    expect(await platformDb.branch.count({ where: { companyId: company.id, isHeadquarters: true } })).toBe(1);
  });

  it("n'active que les modules de l'offre (+ le cœur) — Starter sans Finance ni Stock désactivé selon offre", async () => {
    const { company } = await makeCompany("Starter", "starter");
    const keys = await enabledKeys(company.id);
    expect(keys).toContain("core");
    expect(keys).toContain("sales");
    expect(keys).not.toContain("finance");
    expect(keys).not.toContain("fleet");
  });

  it("l'offre Enterprise active tout", async () => {
    const { company } = await makeCompany("Ent", "enterprise");
    expect((await enabledKeys(company.id)).sort()).toEqual(MODULES.map((m) => m.key).sort());
  });

  it("changer d'offre met à jour les modules hérités mais conserve les surcharges du Super Admin", async () => {
    const { company } = await makeCompany("Switch", "starter");
    const finance = await platformDb.module.findUniqueOrThrow({ where: { key: "finance" } });
    await platformDb.companyModule.update({
      where: { companyId_moduleId: { companyId: company.id, moduleId: finance.id } },
      data: { enabled: true, source: "OVERRIDE" },
    });
    const business = await platformDb.plan.findUniqueOrThrow({ where: { code: "business" } });
    const starter = await platformDb.plan.findUniqueOrThrow({ where: { code: "starter" } });
    await applyPlanModules(platformDb, company.id, business.id);
    expect(await enabledKeys(company.id)).toContain("hr");
    await applyPlanModules(platformDb, company.id, starter.id);
    const keys = await enabledKeys(company.id);
    expect(keys).not.toContain("hr");
    expect(keys).toContain("finance"); // surcharge conservée
  });

  it("refuse une offre inconnue", async () => {
    await expect(makeCompany("Bad", "inexistante")).rejects.toThrow();
  });
});

describe("limites d'usage", () => {
  it("surcharge entreprise > limite du plan", async () => {
    const { company } = await makeCompany("Lim", "starter");
    expect((await getEffectiveLimits(company.id)).users).toBe(5);
    await platformDb.usageLimit.create({ data: { companyId: company.id, key: "users", value: 2 } });
    const limits = await getEffectiveLimits(company.id);
    expect(limits.users).toBe(2);
    const usage = await getUsage(company.id);
    expect(usage.users).toBe(1);
    expect(() => assertWithinLimit(limits, "users", usage.users, 1)).not.toThrow();
    expect(() => assertWithinLimit(limits, "users", usage.users, 2)).toThrow(/Limite/);
  });

  it("-1 = illimité", async () => {
    const { company } = await makeCompany("Unl", "enterprise");
    const limits = await getEffectiveLimits(company.id);
    expect(limits.users).toBe(-1);
    expect(() => assertWithinLimit(limits, "users", 10_000)).not.toThrow();
  });
});
