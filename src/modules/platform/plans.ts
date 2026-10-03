import "server-only";
import { platformDb, platformTransaction } from "@/core/db/client";
import { notFound } from "@/core/errors";
import { LIMIT_KEYS } from "@/core/modules/registry";
import { applyPlanModules } from "@/core/tenant/provisioning";

export async function listPlans() {
  return platformDb.plan.findMany({
    orderBy: { sortOrder: "asc" },
    include: { modules: { include: { module: { select: { key: true } } } }, limits: true, _count: { select: { subscriptions: true } } },
  });
}

export interface PlanUpdate {
  planId: string;
  name: string;
  description?: string | null;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  isPublic: boolean;
  isActive: boolean;
  moduleKeys: string[];
  limits: Record<string, number>;
}

/** Met à jour une offre puis propage ses modules aux entreprises abonnées (surcharges conservées). */
export async function updatePlan(input: PlanUpdate) {
  const existing = await platformDb.plan.findUnique({ where: { id: input.planId } });
  if (!existing) throw notFound("Offre");

  const affected = await platformTransaction(async (tx) => {
    await tx.plan.update({
      where: { id: input.planId },
      data: {
        name: input.name, description: input.description ?? null, priceMonthly: input.priceMonthly, priceYearly: input.priceYearly,
        trialDays: input.trialDays, isPublic: input.isPublic, isActive: input.isActive,
      },
    });
    const modules = await tx.module.findMany({ where: { key: { in: input.moduleKeys } }, select: { id: true } });
    const core = await tx.module.findUniqueOrThrow({ where: { key: "core" } });
    await tx.planModule.deleteMany({ where: { planId: input.planId } });
    const ids = new Set([core.id, ...modules.map((m) => m.id)]);
    await tx.planModule.createMany({ data: [...ids].map((moduleId) => ({ planId: input.planId, moduleId })) });
    for (const { key } of LIMIT_KEYS) {
      const value = input.limits[key];
      if (value === undefined) continue;
      await tx.planLimit.upsert({ where: { planId_key: { planId: input.planId, key } }, create: { planId: input.planId, key, value }, update: { value } });
    }
    const subs = await tx.subscription.findMany({ where: { planId: input.planId }, select: { companyId: true } });
    for (const s of subs) await applyPlanModules(tx, s.companyId, input.planId);
    return subs.length;
  });
  return { affectedCompanies: affected };
}
