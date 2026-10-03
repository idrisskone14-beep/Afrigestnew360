import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { LIMIT_KEYS, MODULES, UNLIMITED } from "@/core/modules/registry";
import { requirePagePermission } from "@/core/tenant/guards";
import { formatMoney } from "@/lib/reference-data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Paramètres — Abonnement" };

const STATUS: Record<string, { label: string; tone: string }> = {
  TRIALING: { label: "Période d'essai", tone: "bg-warning/15 text-warning" },
  ACTIVE: { label: "Actif", tone: "bg-success/15 text-success" },
  PAST_DUE: { label: "Paiement en retard", tone: "bg-destructive/15 text-destructive" },
  CANCELED: { label: "Résilié", tone: "bg-muted text-muted-foreground" },
};
const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

export default async function SubscriptionPage() {
  const ctx = await requirePagePermission("settings.billing.read");
  const [sub, limits, usage] = await Promise.all([
    ctx.db.subscription.findFirst({ include: { plan: { select: { name: true, description: true } } } }),
    getEffectiveLimits(ctx.company.id),
    getUsage(ctx.company.id),
  ]);
  const status = sub ? STATUS[sub.status] : undefined;
  const modules = MODULES.filter((m) => m.kind !== "CORE" && ctx.hasModule(m.key));

  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Offre {sub?.plan.name ?? "—"}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{sub?.plan.description}</p>
          </div>
          {status && <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", status.tone)}>{status.label}</span>}
        </CardHeader>
        {sub && (
          <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
            <Info label="Tarif" value={`${formatMoney(Number(sub.priceAmount), sub.currency)} / ${sub.billingCycle === "MONTHLY" ? "mois" : "an"}`} />
            <Info label="Période en cours" value={`jusqu'au ${dateFmt.format(sub.currentPeriodEnd)}`} />
            {sub.trialEndsAt && <Info label="Fin de l'essai" value={dateFmt.format(sub.trialEndsAt)} />}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Utilisation et limites</CardTitle></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {LIMIT_KEYS.map(({ key, label }) => {
            const max = limits[key];
            const used = usage[key];
            const pct = max === UNLIMITED ? 0 : max === 0 ? 100 : Math.min(100, Math.round((used / max) * 100));
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="tabular text-muted-foreground">{used} / {max === UNLIMITED ? "illimité" : max}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
                  <div className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-brand")} style={{ width: `${max === UNLIMITED ? 0 : pct}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Modules inclus</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {modules.length ? modules.map((m) => <Badge key={m.key} variant="secondary">{m.name}</Badge>) : <p className="text-sm text-muted-foreground">Aucun module métier actif.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
