"use client";

import { useState, useTransition } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/reference-data";
import { cn } from "@/lib/utils";
import { startSubscriptionPaymentAction } from "@/modules/billing/actions";

export interface PayablePlan { id: string; name: string; currency: string; priceMonthly: number; priceYearly: number }

/** Paiement en ligne de l'abonnement (Mobile Money, cartes) : le montant est recalculé côté serveur à partir de l'offre. */
export function PayCard({ plans, currentPlanId }: { plans: PayablePlan[]; currentPlanId: string | null }) {
  const [planId, setPlanId] = useState(plans.find((p) => p.id === currentPlanId)?.id ?? plans[0]?.id ?? "");
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [pending, start] = useTransition();
  const plan = plans.find((p) => p.id === planId);
  const price = plan ? (cycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly) : 0;

  const pay = () => start(async () => {
    const res = await startSubscriptionPaymentAction({ planId, cycle });
    if (!res.ok) { toast.error(res.error.message); return; }
    window.location.assign(res.data.url);
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Payer en ligne</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Réglez ou renouvelez votre abonnement par Mobile Money ou carte bancaire. La période payée s'ajoute à celle en cours.</p>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Offre">
          {plans.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === planId} onClick={() => setPlanId(p.id)}
              className={cn("rounded-lg border p-3 text-left text-sm transition-colors", p.id === planId ? "border-brand bg-brand/5" : "hover:bg-muted/50")}>
              <span className="font-medium">{p.name}</span>
              {p.id === currentPlanId && <span className="ml-2 text-xs text-muted-foreground">offre actuelle</span>}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border p-0.5 text-sm" role="radiogroup" aria-label="Périodicité">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === cycle} onClick={() => setCycle(c)}
              className={cn("rounded-md px-3 py-1.5", c === cycle ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground")}>
              {c === "MONTHLY" ? "Mensuel" : "Annuel"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm">À payer : <span className="font-display text-lg font-semibold tabular">{plan && price > 0 ? formatMoney(price, plan.currency) : "—"}</span></p>
          <Button onClick={pay} disabled={pending || !plan || price <= 0}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CreditCard className="size-4" aria-hidden />}
            Payer avec PayDunya
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
