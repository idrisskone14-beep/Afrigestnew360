import "server-only";
import { platformDb } from "@/core/db/client";
import { buildAccess } from "@/core/rbac/access";
import { createTenantContext, type TenantContext } from "./ctx-factory";

/**
 * Contexte d'exécution des tâches planifiées (cron) : agit AU NOM d'un membre de l'entreprise — de préférence l'auteur du modèle,
 * sinon le propriétaire — avec SES droits et SES modules actifs, jamais davantage. Renvoie null si l'entreprise est suspendue/supprimée
 * ou si aucun membre actif ne peut porter l'action.
 */
export async function systemContextFor(companyId: string, preferredUserId?: string | null): Promise<TenantContext | null> {
  const company = await platformDb.company.findFirst({ where: { id: companyId, deletedAt: null, status: "ACTIVE" } });
  if (!company) return null;
  const include = { user: true, role: true } as const;
  const membership =
    (preferredUserId ? await platformDb.companyMembership.findFirst({ where: { companyId, userId: preferredUserId, status: "ACTIVE" }, include }) : null) ??
    (await platformDb.companyMembership.findFirst({ where: { companyId, status: "ACTIVE", isOwner: true }, include }));
  if (!membership) return null;
  const [grants, mods] = await Promise.all([
    membership.role.isAdmin ? [] : platformDb.rolePermission.findMany({ where: { roleId: membership.roleId }, select: { permission: { select: { key: true } } } }),
    platformDb.companyModule.findMany({ where: { companyId, enabled: true, module: { isActive: true } }, select: { module: { select: { key: true } } } }),
  ]);
  return createTenantContext({
    user: { id: membership.user.id, name: membership.user.name, email: membership.user.email, isPlatformAdmin: false, locale: "fr", twoFactorEnabled: false, emailVerified: true },
    sessionId: "cron",
    company: { id: company.id, legalName: company.legalName, tradeName: company.tradeName, slug: company.slug, currency: company.currency, timezone: company.timezone, country: company.country, logoUrl: null },
    membership: { id: membership.id, roleId: membership.roleId, roleName: membership.role.name, isOwner: membership.isOwner },
    access: buildAccess({ isAdmin: membership.role.isAdmin, grantedKeys: grants.map((g) => g.permission.key), enabledModules: mods.map((m) => m.module.key) }),
    switcher: [],
  });
}
