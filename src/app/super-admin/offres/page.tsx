import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { MODULES } from "@/core/modules/registry";
import { listPlans } from "@/modules/platform/plans";
import { PlanEditor } from "./plan-editor";

export const metadata: Metadata = { title: "Offres" };

export default async function PlansPage() {
  const plans = await listPlans();
  return (
    <>
      <PageHeader title="Offres" description="Prix, modules inclus et limites par offre. Toute modification est propagée aux entreprises abonnées (les surcharges manuelles sont conservées)." />
      <div className="grid gap-6">
        {plans.map((p) => (
          <PlanEditor
            key={p.id}
            subscribers={p._count.subscriptions}
            modules={MODULES.filter((m) => m.kind !== "CORE").map((m) => ({ key: m.key, name: m.name, kind: m.kind }))}
            plan={{
              id: p.id, code: p.code, name: p.name, description: p.description ?? "", priceMonthly: Number(p.priceMonthly), priceYearly: Number(p.priceYearly),
              trialDays: p.trialDays, isPublic: p.isPublic, isActive: p.isActive,
              moduleKeys: p.modules.map((m) => m.module.key),
              limits: Object.fromEntries(p.limits.map((l) => [l.key, l.value])),
            }}
          />
        ))}
      </div>
    </>
  );
}
