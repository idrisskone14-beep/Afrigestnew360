import "server-only";
import { platformDb } from "@/core/db/client";

/**
 * Lectures d'accès d'un utilisateur, en 4 requêtes parallèles : ses appartenances actives (entreprise + rôle) et, pour
 * TOUTES ses entreprises, les droits de ses rôles, les modules activés et les abonnements. L'appelant filtre ensuite sur
 * l'entreprise active. Exportée pour être testée contre les requêtes « une entreprise à la fois » (voir les tests).
 */
export async function readAccessData(userId: string) {
  const mine = { some: { userId, status: "ACTIVE" as const } };
  const [memberships, allGrants, allModules, allSubscriptions] = await Promise.all([
    platformDb.companyMembership.findMany({
      where: { userId, status: "ACTIVE", company: { deletedAt: null } },
      include: {
        company: {
          select: {
            id: true, legalName: true, tradeName: true, slug: true, currency: true, timezone: true,
            country: true, logoUrl: true, status: true,
          },
        },
        role: { select: { id: true, name: true, isAdmin: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    platformDb.rolePermission.findMany({ where: { role: { memberships: mine } }, select: { roleId: true, permission: { select: { key: true } } } }),
    platformDb.companyModule.findMany({
      where: { enabled: true, module: { isActive: true }, company: { memberships: mine } },
      select: { companyId: true, module: { select: { key: true } } },
    }),
    platformDb.subscription.findMany({ where: { company: { memberships: mine } }, select: { companyId: true, status: true } }),
  ]);
  return { memberships, allGrants, allModules, allSubscriptions };
}
