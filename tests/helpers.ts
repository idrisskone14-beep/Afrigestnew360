import { randomUUID } from "node:crypto";
import { hashPassword } from "@/core/auth/password";
import { platformDb } from "@/core/db/client";
import { provisionCompany } from "@/core/tenant/provisioning";

export const uid = () => randomUUID().slice(0, 8);

export async function makeUser(overrides: { email?: string; password?: string; name?: string } = {}) {
  const email = overrides.email ?? `user-${uid()}@test.local`;
  return platformDb.user.create({
    data: {
      email,
      name: overrides.name ?? "Test User",
      passwordHash: await hashPassword(overrides.password ?? "Passw0rd!Test"),
      emailVerifiedAt: new Date(),
    },
  });
}

export async function makeCompany(label: string, planCode = "enterprise") {
  const owner = await makeUser();
  const { company, adminRoleId } = await provisionCompany({
    legalName: `${label} ${uid()}`,
    planCode,
    ownerUserId: owner.id,
  });
  return { company, owner, adminRoleId };
}

/** Reconstitue un TenantContext comme `loadContextState` (sans session HTTP) : membership, rôle, modules actifs. */
export async function ctxFor(userId: string, companyId: string) {
  const { createTenantContext } = await import("@/core/tenant/ctx-factory");
  const { buildAccess } = await import("@/core/rbac/access");
  const m = await platformDb.companyMembership.findUniqueOrThrow({
    where: { userId_companyId: { userId, companyId } },
    include: { company: true, role: true, user: true },
  });
  const [grants, mods] = await Promise.all([
    m.role.isAdmin ? [] : platformDb.rolePermission.findMany({ where: { roleId: m.roleId }, select: { permission: { select: { key: true } } } }),
    platformDb.companyModule.findMany({ where: { companyId, enabled: true, module: { isActive: true } }, select: { module: { select: { key: true } } } }),
  ]);
  return createTenantContext({
    user: { id: m.user.id, name: m.user.name, email: m.user.email, isPlatformAdmin: false, locale: "fr", twoFactorEnabled: false, emailVerified: true },
    sessionId: "test-session",
    company: { id: m.company.id, legalName: m.company.legalName, tradeName: m.company.tradeName, slug: m.company.slug, currency: m.company.currency, timezone: m.company.timezone, country: m.company.country, logoUrl: null },
    membership: { id: m.id, roleId: m.roleId, roleName: m.role.name, isOwner: m.isOwner },
    access: buildAccess({ isAdmin: m.role.isAdmin, grantedKeys: grants.map((g) => g.permission.key), enabledModules: mods.map((x) => x.module.key) }),
    switcher: [],
  });
}

export async function addMember(companyId: string, templateKey: string) {
  const user = await makeUser();
  const role = await platformDb.role.findFirstOrThrow({ where: { companyId, templateKey } });
  const membership = await platformDb.companyMembership.create({ data: { userId: user.id, companyId, roleId: role.id } });
  return { user, role, membership };
}
