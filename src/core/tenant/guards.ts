import "server-only";
import { forbidden, notFound, redirect } from "next/navigation";
import { getCurrentSession, type CurrentSession } from "@/core/auth/session";
import { PERMISSION_BY_KEY } from "@/core/rbac/catalog";
import { loadContextState, type TenantContext } from "./context";

/** Pages : utilisateur connecté (sans exigence d'entreprise). */
export async function requireUser(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/connexion");
  return session;
}

/** Pages : contexte tenant complet, sinon redirection adaptée. */
export async function requireTenantContext(): Promise<TenantContext> {
  const state = await loadContextState();
  switch (state.status) {
    case "ok":
      return state.ctx;
    case "unauthenticated":
      redirect("/connexion");
    case "no_company":
      redirect("/app/onboarding");
    case "suspended":
      redirect("/app/suspendue");
  }
}

/** Pages : refuse (403) si le module est désactivé pour l'entreprise — y compris par URL directe. */
export async function requireModulePage(moduleKey: string): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  if (!ctx.hasModule(moduleKey)) forbidden();
  return ctx;
}

/** Pages : refuse (403) si la permission (et donc son module) n'est pas accordée. */
export async function requirePagePermission(permission: string): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  if (!PERMISSION_BY_KEY.has(permission)) throw new Error(`Permission inconnue : ${permission}`);
  if (!ctx.can(permission)) forbidden();
  return ctx;
}

/** Console Super Admin : réservée au propriétaire de la plateforme. 404 pour les autres (non découvrable). */
export async function requirePlatformAdmin(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/connexion?next=/super-admin");
  if (!session.user.isPlatformAdmin) notFound();
  return session;
}
