import "server-only";
import { platformDb } from "@/core/db/client";
import { limitReached } from "@/core/errors";
import { LIMIT_KEYS, UNLIMITED, type LimitKey } from "./registry";

export type EffectiveLimits = Record<LimitKey, number>;

/** Limites effectives : surcharge entreprise (UsageLimit) > limite du plan (PlanLimit) > illimité si non définie. */
export async function getEffectiveLimits(companyId: string): Promise<EffectiveLimits> {
  const [sub, overrides] = await Promise.all([
    platformDb.subscription.findUnique({
      where: { companyId },
      select: { plan: { select: { limits: true } } },
    }),
    platformDb.usageLimit.findMany({ where: { companyId } }),
  ]);
  const result = Object.fromEntries(LIMIT_KEYS.map((l) => [l.key, UNLIMITED])) as EffectiveLimits;
  for (const l of sub?.plan.limits ?? []) if (l.key in result) result[l.key as LimitKey] = l.value;
  for (const o of overrides) if (o.key in result) result[o.key as LimitKey] = o.value;
  return result;
}

export type Usage = Record<LimitKey, number>;

/**
 * Consommation courante par limite. Les compteurs des modules métier s'ajoutent à mesure que
 * leurs tables sont livrées (employés, produits, clients, projets, véhicules, documents…).
 */
export async function getUsage(companyId: string): Promise<Usage> {
  const [users, pendingInvites, customers, products] = await Promise.all([
    platformDb.companyMembership.count({ where: { companyId, status: "ACTIVE" } }),
    platformDb.invitation.count({ where: { companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    platformDb.customer.count({ where: { companyId, deletedAt: null } }),
    platformDb.product.count({ where: { companyId, deletedAt: null } }),
  ]);
  const usage = Object.fromEntries(LIMIT_KEYS.map((l) => [l.key, 0])) as Usage;
  usage.users = users + pendingInvites;
  usage.customers = customers;
  usage.products = products;
  return usage;
}

/** Refuse la création si la limite est atteinte. `adding` = nombre d'éléments à ajouter. */
export function assertWithinLimit(limits: EffectiveLimits, key: LimitKey, current: number, adding = 1) {
  const max = limits[key];
  if (max === UNLIMITED) return;
  if (current + adding > max) {
    const label = LIMIT_KEYS.find((l) => l.key === key)?.label ?? key;
    throw limitReached(`Limite de votre offre atteinte pour « ${label} » (${max}). Contactez-nous pour augmenter votre quota.`);
  }
}
