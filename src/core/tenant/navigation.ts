import { MODULES } from "@/core/modules/registry";
import { PERMISSIONS } from "@/core/rbac/catalog";
import type { TenantContext } from "./context";

export interface NavModule {
  key: string;
  name: string;
  icon: string;
  href: string;
  kind: "CORE" | "STANDARD" | "EXTENSION";
}

/**
 * Modules visibles dans le menu : activés pour l'entreprise ET dont l'utilisateur détient au moins
 * une permission. Le menu n'est qu'un reflet : chaque page revérifie côté serveur.
 */
export function visibleModules(ctx: Pick<TenantContext, "access" | "can">): NavModule[] {
  return MODULES.filter((m) => m.kind !== "CORE")
    .filter((m) => ctx.access.modules.has(m.key))
    .filter((m) => ctx.access.isAdmin || PERMISSIONS.some((p) => p.module === m.key && ctx.can(p.key)))
    .map((m) => ({ key: m.key, name: m.name, icon: m.icon, href: `/app/${m.key}`, kind: m.kind }));
}
