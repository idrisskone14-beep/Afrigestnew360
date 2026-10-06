import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { acceptSessionRow, readJwtSession, type SessionUser } from "@/core/auth/session";
import { platformDb } from "@/core/db/client";
import { readAccessData } from "./access-data";
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
  const jwt = await readJwtSession();
  if (!jwt) return { status: "unauthenticated" };

  // UNE seule étape de lectures parallèles (au lieu de trois étapes successives : session → appartenances → droits).
  // Rien n'est utilisé avant que la session soit validée (révoquée / expirée → on jette tout).
  const [row, { memberships, allGrants, allModules, allSubscriptions }] = await Promise.all([
    platformDb.userSession.findUnique({ where: { id: jwt.sid }, include: { user: true } }),
    readAccessData(jwt.userId),
  ]);

  const current = await acceptSessionRow(row, jwt.userId, jwt.sid);
  if (!current) return { status: "unauthenticated" };
  const { user, sessionId } = current;

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

  const grants = active.role.isAdmin ? [] : allGrants.filter((g) => g.roleId === active.role.id);
  const companyModules = allModules.filter((m) => m.companyId === active.company.id);
  const subscription = allSubscriptions.find((s) => s.companyId === active.company.id);

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
