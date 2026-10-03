import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { scopeArgs } from "./scope";

/** Client typé « modèles uniquement » : pas de $transaction/$connect exposés aux services. */
export type Db = Prisma.TransactionClient;

const g = globalThis as unknown as { __afgPrisma?: PrismaClient };

function createBase(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis.");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    // Défauts de Prisma (attente 2 s, exécution 5 s) trop justes : première compilation en développement, base distante
    // ou pic de charge faisaient échouer des requêtes pourtant correctes (« Unable to start a transaction in the given time »).
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

/**
 * Client brut, SANS contexte d'isolation : ne jamais l'importer hors de `src/core/db`.
 * Utiliser `tenantDb(companyId)` (application) ou `platformDb` (plateforme / authentification).
 */
export const baseClient: PrismaClient = g.__afgPrisma ?? createBase();
if (process.env.NODE_ENV !== "production") g.__afgPrisma = baseClient;

/** Pose le contexte RLS pour la transaction courante (set_config(..., local = true)). */
export function setTenantContext(tx: Pick<Db, "$executeRaw">, companyId: string) {
  return tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
}
export function setBypassContext(tx: Pick<Db, "$executeRaw">) {
  return tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(companyId: string) {
  if (!UUID_RE.test(companyId)) throw new Error("companyId invalide.");
}

/**
 * Client isolé sur UNE entreprise : chaque requête est (1) filtrée/estampillée par `scopeArgs`
 * puis (2) exécutée dans une transaction où `app.company_id` est posé → RLS PostgreSQL.
 */
export function tenantDb(companyId: string): Db {
  assertUuid(companyId);
  const extended = baseClient.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = scopeArgs(model, operation, args, companyId);
          const [, result] = await baseClient.$transaction([
            baseClient.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`,
            query(scoped as typeof args),
          ]);
          return result;
        },
      },
    },
  });
  return extended as unknown as Db;
}

/**
 * Transaction interactive isolée : contexte RLS posé une fois, requêtes du callback
 * filtrées/estampillées. À utiliser pour toute écriture multi-étapes (facture + lignes + écritures…).
 */
export async function tenantTransaction<T>(
  companyId: string,
  fn: (tx: Db) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  assertUuid(companyId);
  const scoped = baseClient.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args, companyId) as typeof args);
        },
      },
    },
  });
  return scoped.$transaction(
    async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx as unknown as Db);
    },
    { timeout: options?.timeoutMs ?? 15_000 },
  );
}

/**
 * Client PLATEFORME : contourne la RLS (bypass explicite). Réservé à l'authentification, au
 * provisioning et à /super-admin (règle ESLint). Ne jamais l'utiliser avec une entrée utilisateur
 * non validée pour choisir une entreprise.
 */
export const platformDb: Db = baseClient.$extends({
  name: "platform-bypass",
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const [, result] = await baseClient.$transaction([
          baseClient.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`,
          query(args),
        ]);
        return result;
      },
    },
  },
}) as unknown as Db;

export async function platformTransaction<T>(
  fn: (tx: Db) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return baseClient.$transaction(
    async (tx) => {
      await setBypassContext(tx);
      return fn(tx as unknown as Db);
    },
    { timeout: options?.timeoutMs ?? 15_000 },
  );
}

export { Prisma };
