import { beforeAll, describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { readAccessData } from "@/core/tenant/access-data";
import { addMember, makeCompany, makeUser } from "../helpers";

/**
 * Le chargement du contexte lit droits, modules et abonnements de TOUTES les entreprises de l'utilisateur en une seule
 * étape, puis filtre sur l'entreprise active. Ce test prouve que ce résultat est identique, entreprise par entreprise, aux
 * lectures « une entreprise à la fois » d'origine — et qu'aucune donnée d'une entreprise dont l'utilisateur n'est pas
 * membre ne remonte (isolation).
 */
describe("chargement groupé du contexte", () => {
  let A: Awaited<ReturnType<typeof makeCompany>>;
  let B: Awaited<ReturnType<typeof makeCompany>>;
  let outsider: Awaited<ReturnType<typeof makeCompany>>;
  let userId: string;
  let roleInB: string;

  beforeAll(async () => {
    A = await makeCompany("Ctx A", "enterprise");
    B = await makeCompany("Ctx B", "starter");
    outsider = await makeCompany("Ctx hors-sujet", "enterprise");
    // un utilisateur membre de A (administrateur) et de B (rôle « consultation »)
    const u = await makeUser();
    userId = u.id;
    const adminRoleA = await platformDb.role.findFirstOrThrow({ where: { companyId: A.company.id, isAdmin: true } });
    await platformDb.companyMembership.create({ data: { userId, companyId: A.company.id, roleId: adminRoleA.id } });
    const viewer = await addMember(B.company.id, "viewer");
    roleInB = viewer.role.id;
    await platformDb.companyMembership.create({ data: { userId, companyId: B.company.id, roleId: roleInB } });
  });

  it("appartenances : uniquement les entreprises dont l'utilisateur est membre actif", async () => {
    const { memberships } = await readAccessData(userId);
    expect(memberships.map((m) => m.company.id).sort()).toEqual([A.company.id, B.company.id].sort());
    expect(memberships.map((m) => m.company.id)).not.toContain(outsider.company.id);
  });

  it("modules et abonnements : identiques aux lectures par entreprise, sans fuite vers une entreprise tierce", async () => {
    const { allModules, allSubscriptions } = await readAccessData(userId);
    for (const company of [A.company, B.company]) {
      const old = await platformDb.companyModule.findMany({ where: { companyId: company.id, enabled: true, module: { isActive: true } }, select: { module: { select: { key: true } } } });
      const grouped = allModules.filter((m) => m.companyId === company.id).map((m) => m.module.key).sort();
      expect(grouped).toEqual(old.map((m) => m.module.key).sort());
      expect(grouped.length).toBeGreaterThan(0);

      const oldSub = await platformDb.subscription.findUnique({ where: { companyId: company.id }, select: { status: true } });
      expect(allSubscriptions.find((s) => s.companyId === company.id)?.status).toBe(oldSub?.status);
    }
    expect(allModules.some((m) => m.companyId === outsider.company.id)).toBe(false);
    expect(allSubscriptions.some((s) => s.companyId === outsider.company.id)).toBe(false);
  });

  it("deux offres différentes donnent bien deux jeux de modules différents (le filtre par entreprise compte)", async () => {
    const { allModules } = await readAccessData(userId);
    const keys = (id: string) => allModules.filter((m) => m.companyId === id).map((m) => m.module.key).sort();
    expect(keys(A.company.id)).not.toEqual(keys(B.company.id));
  });

  it("droits : ceux du rôle de l'utilisateur dans l'entreprise, identiques à la lecture par rôle, sans les droits d'un autre rôle", async () => {
    const { allGrants } = await readAccessData(userId);
    const old = await platformDb.rolePermission.findMany({ where: { roleId: roleInB }, select: { permission: { select: { key: true } } } });
    const grouped = allGrants.filter((g) => g.roleId === roleInB).map((g) => g.permission.key).sort();
    expect(grouped).toEqual(old.map((g) => g.permission.key).sort());
    expect(grouped.length).toBeGreaterThan(0);
    // le rôle « consultation » ne contient que des lectures
    expect(grouped.every((k) => k.endsWith(".read"))).toBe(true);
    // aucun rôle de l'entreprise tierce ne remonte
    const outsiderRoles = await platformDb.role.findMany({ where: { companyId: outsider.company.id }, select: { id: true } });
    const outsiderIds = new Set(outsiderRoles.map((r) => r.id));
    expect(allGrants.some((g) => outsiderIds.has(g.roleId))).toBe(false);
  });

  it("un membre suspendu ou retiré ne voit plus l'entreprise", async () => {
    const stranger = await makeUser();
    const m = await platformDb.companyMembership.create({ data: { userId: stranger.id, companyId: A.company.id, roleId: A.adminRoleId } });
    expect((await readAccessData(stranger.id)).memberships).toHaveLength(1);
    await platformDb.companyMembership.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
    const after = await readAccessData(stranger.id);
    expect(after.memberships).toHaveLength(0);
    expect(after.allGrants).toHaveLength(0);
    expect(after.allModules).toHaveLength(0);
  });
});
