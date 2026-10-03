import { ALWAYS_ENABLED } from "@/core/modules/registry";
import { PERMISSION_BY_KEY } from "./catalog";

/** Droits effectifs d'un membre dans une entreprise : rôle ∩ modules activés. Pur et testable. */
export interface Access {
  isAdmin: boolean;
  /** Permissions explicitement accordées au rôle. */
  granted: ReadonlySet<string>;
  /** Modules activés pour l'entreprise (le cœur est toujours inclus). */
  modules: ReadonlySet<string>;
}

export function buildAccess(input: {
  isAdmin: boolean;
  grantedKeys: Iterable<string>;
  enabledModules: Iterable<string>;
}): Access {
  return {
    isAdmin: input.isAdmin,
    granted: new Set(input.grantedKeys),
    modules: new Set([...ALWAYS_ENABLED, ...input.enabledModules]),
  };
}

export function hasModule(access: Access, moduleKey: string): boolean {
  return access.modules.has(moduleKey);
}

/**
 * Une permission est effective si (1) elle existe au catalogue, (2) son module est actif
 * pour l'entreprise et (3) le rôle l'accorde (ou est administrateur).
 */
export function can(access: Access, permissionKey: string): boolean {
  const def = PERMISSION_BY_KEY.get(permissionKey);
  if (!def) return false;
  if (!access.modules.has(def.module)) return false;
  return access.isAdmin || access.granted.has(permissionKey);
}

export function canAny(access: Access, keys: readonly string[]): boolean {
  return keys.some((k) => can(access, k));
}

export function canAll(access: Access, keys: readonly string[]): boolean {
  return keys.every((k) => can(access, k));
}

/** Liste des permissions effectives (utile pour l'UI et les tests). */
export function effectivePermissions(access: Access): string[] {
  return [...PERMISSION_BY_KEY.keys()].filter((k) => can(access, k));
}
