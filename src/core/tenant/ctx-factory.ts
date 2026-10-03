import { tenantDb, tenantTransaction, type Db } from "@/core/db/client";
import type { SessionUser } from "@/core/auth/session";
import { forbidden, moduleDisabled } from "@/core/errors";
import { MODULE_BY_KEY } from "@/core/modules/registry";
import { can as canAccess, hasModule as hasModuleAccess, type Access } from "@/core/rbac/access";
import { PERMISSION_BY_KEY } from "@/core/rbac/catalog";

export interface ActiveCompany {
  id: string;
  legalName: string;
  tradeName: string | null;
  slug: string;
  currency: string;
  timezone: string;
  country: string;
  logoUrl: string | null;
}

export interface SwitcherItem {
  companyId: string;
  name: string;
  roleName: string;
  suspended: boolean;
  logoUrl: string | null;
}

export interface TenantContext {
  user: SessionUser;
  sessionId: string;
  company: ActiveCompany;
  membership: { id: string; roleId: string; roleName: string; isOwner: boolean };
  access: Access;
  switcher: SwitcherItem[];
  /** Client isolé (filtre + RLS). Chaque appel = une requête isolée. */
  db: Db;
  /** Transaction interactive isolée, pour les écritures multi-étapes. */
  tx: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
  can: (permission: string) => boolean;
  hasModule: (moduleKey: string) => boolean;
  assertCan: (permission: string) => void;
  assertModule: (moduleKey: string) => void;
}


/** Construit un contexte à partir de données DÉJÀ vérifiées (membership + entreprise). Exporté pour les tests. */
export function createTenantContext(args: {
  user: SessionUser;
  sessionId: string;
  company: ActiveCompany;
  membership: TenantContext["membership"];
  access: Access;
  switcher: SwitcherItem[];
}): TenantContext {
  const { access, company } = args;
  const ctx: TenantContext = {
    ...args,
    db: tenantDb(company.id),
    tx: (fn) => tenantTransaction(company.id, fn),
    can: (permission) => canAccess(access, permission),
    hasModule: (key) => hasModuleAccess(access, key),
    assertCan(permission) {
      const def = PERMISSION_BY_KEY.get(permission);
      if (!def) throw new Error(`Permission inconnue : ${permission}`);
      if (!hasModuleAccess(access, def.module)) {
        throw moduleDisabled(MODULE_BY_KEY.get(def.module)?.name ?? def.module);
      }
      if (!canAccess(access, permission)) throw forbidden();
    },
    assertModule(key) {
      if (!hasModuleAccess(access, key)) throw moduleDisabled(MODULE_BY_KEY.get(key)?.name ?? key);
    },
  };
  return ctx;
}

