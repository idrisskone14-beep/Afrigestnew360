import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentSession, type SessionUser } from "@/core/auth/session";
import { platformDb } from "@/core/db/client";
import { AppError, unauthenticated } from "@/core/errors";
import { buildAccess } from "@/core/rbac/access";
import { createTenantContext, type ActiveCompany, type SwitcherItem, type TenantContext } from "./ctx-factory";

export { createTenantContext };
export type { ActiveCompany, SwitcherItem, TenantContext };

export const ACTIVE_COMPANY_COOKIE = "afg_company";

export type ContextState =
  | { status: "unauthenticated" }
  | { status: "no_company"; user: SessionUser; sessionId: string }
  | { status: "suspended"; user: SessionUser; sessionId: string; companyName: string }
  | { status: "ok"; ctx: TenantContext };

/**
 * Détermine le contexte tenant. L'entreprise active vient d'un cookie NON FIABLE : elle n'est retenue
 * que si l'utilisateur en est membre actif (revérifié en base à chaque requête).
 */
export const loadContextState = cache(async (): Promise<ContextState> => {
  const current = await getCurrentSession();
  if (!current) return { status: "unauthenticated" };
  const { user, sessionId } = current;

  const memberships = await platformDb.companyMembership.findMany({
    where: { userId: user.id, status: "ACTIVE", company: { deletedAt: null } },
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
  });

  if (memberships.length === 0) return { status: "no_company", user, sessionId };

  const switcher: SwitcherItem[] = memberships.map((m) => ({
    companyId: m.company.id,
    name: m.company.tradeName ?? m.company.legalName,
    roleName: m.role.name,
    suspended: m.company.status !== "ACTIVE",
    logoUrl: m.company.logoUrl,
  }));

  const usable = memberships.filter((m) => m.company.status === "ACTIVE");
  if (usable.length === 0) {
    const first = memberships[0]!;
    return { status: "suspended", user, sessionId, companyName: first.company.tradeName ?? first.company.legalName };
  }

  const wanted = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const active = usable.find((m) => m.company.id === wanted) ?? usable[0]!;

  const [grants, companyModules, subscription] = await Promise.all([
    active.role.isAdmin
      ? Promise.resolve([] as { permission: { key: string } }[])
      : platformDb.rolePermission.findMany({
          where: { roleId: active.role.id },
          select: { permission: { select: { key: true } } },
        }),
    platformDb.companyModule.findMany({
      where: { companyId: active.company.id, enabled: true, module: { isActive: true } },
      select: { module: { select: { key: true } } },
    }),
    platformDb.subscription.findUnique({
      where: { companyId: active.company.id },
      select: { status: true },
    }),
  ]);

  // Abonnement résilié : seul le cœur reste accessible (lecture/gestion de compte).
  const enabledModules = subscription?.status === "CANCELED" ? [] : companyModules.map((c) => c.module.key);

  const ctx = createTenantContext({
    user,
    sessionId,
    company: {
      id: active.company.id,
      legalName: active.company.legalName,
      tradeName: active.company.tradeName,
      slug: active.company.slug,
      currency: active.company.currency,
      timezone: active.company.timezone,
      country: active.company.country,
      logoUrl: active.company.logoUrl,
    },
    membership: { id: active.id, roleId: active.role.id, roleName: active.role.name, isOwner: active.isOwner },
    access: buildAccess({
      isAdmin: active.role.isAdmin,
      grantedKeys: grants.map((g) => g.permission.key),
      enabledModules,
    }),
    switcher,
  });
  return { status: "ok", ctx };
});

/** Pour les Server Actions / Route Handlers : lève une AppError au lieu de rediriger. */
export async function requireActionContext(): Promise<TenantContext> {
  const state = await loadContextState();
  switch (state.status) {
    case "ok":
      return state.ctx;
    case "unauthenticated":
      throw unauthenticated();
    case "no_company":
      throw new AppError("FORBIDDEN", "Vous n'appartenez à aucune entreprise.");
    case "suspended":
      throw new AppError("FORBIDDEN", "Cette entreprise est suspendue.");
  }
}
