import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { LIMIT_KEYS, MODULES, UNLIMITED } from "@/core/modules/registry";
import { requirePagePermission } from "@/core/tenant/guards";
import { formatMoney } from "@/lib/reference-data";
import { cn } from "@/lib/utils";
import { isPaymentConfigured, listPayablePlans, settlePayment } from "@/modules/platform/billing";
import { PayCard } from "./pay-card";

export const metadata: Metadata = { title: "Paramètres — Abonnement" };

const STATUS: Record<string, { label: string; tone: string }> = {
  TRIALING: { label: "Période d'essai", tone: "bg-warning/15 text-warning" },
  ACTIVE: { label: "Actif", tone: "bg-success/15 text-success" },
  PAST_DUE: { label: "Paiement en retard", tone: "bg-destructive/15 text-destructive" },
  CANCELED: { label: "Résilié", tone: "bg-muted text-muted-foreground" },
};
const PAYMENT_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "En attente", tone: "bg-warning/15 text-warning" },
  COMPLETED: { label: "Payé", tone: "bg-success/15 text-success" },
  FAILED: { label: "Échoué", tone: "bg-destructive/15 text-destructive" },
  CANCELED: { label: "Annulé", tone: "bg-muted text-muted-foreground" },
};
const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ paiement?: string }> }) {
  const ctx = await requirePagePermission("settings.billing.read");
  // retour de la page de paiement : l'état est relu auprès de PayDunya (jamais déduit de l'adresse) avant d'afficher quoi que ce soit
  const { paiement } = await searchParams;
  let returned: Awaited<ReturnType<typeof settlePayment>> = null;
  if (paiement && UUID.test(paiement)) returned = await settlePayment({ id: paiement, companyId: ctx.company.id }).catch((e) => { console.error("[billing:return]", e); return null; });
  const canPay = isPaymentConfigured() && ctx.can("settings.billing.update");
  const [sub, limits, usage, payments, payablePlans] = await Promise.all([
    ctx.db.subscription.findFirst({ include: { plan: { select: { name: true, description: true } } } }),
    getEffectiveLimits(ctx.company.id),
    getUsage(ctx.company.id),
    ctx.db.subscriptionPayment.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { plan: { select: { name: true } } } }),
    canPay ? listPayablePlans() : Promise.resolve([]),
  ]);
  const status = sub ? STATUS[sub.status] : undefined;
  const modules = MODULES.filter((m) => m.kind !== "CORE" && ctx.hasModule(m.key));

  return (
    <div className="grid max-w-4xl gap-6">
      {returned && <ReturnBanner status={returned.status} />}
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

      {canPay && payablePlans.length > 0 && (
        <PayCard currentPlanId={sub?.planId ?? null} plans={payablePlans.map((p) => ({ id: p.id, name: p.name, currency: p.currency, priceMonthly: Number(p.priceMonthly), priceYearly: Number(p.priceYearly) }))} />
      )}

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

      {payments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Paiements</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {payments.map((p) => {
                const st = PAYMENT_STATUS[p.status]!;
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium">Offre {p.plan.name} · {p.billingCycle === "YEARLY" ? "annuel" : "mensuel"}</p>
                      <p className="text-xs text-muted-foreground">{dateFmt.format(p.paidAt ?? p.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular">{formatMoney(Number(p.amount), p.currency)}</span>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", st.tone)}>{st.label}</span>
                      {p.status === "PENDING" && <Link href={`/app/parametres/abonnement?paiement=${p.id}`} className="text-xs text-brand hover:underline">Vérifier</Link>}
                      {p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">Reçu</a>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReturnBanner({ status }: { status: string }) {
  const m = {
    COMPLETED: { tone: "border-success/40 bg-success/10 text-success", text: "Paiement reçu : votre abonnement est à jour. Merci !" },
    PENDING: { tone: "border-warning/40 bg-warning/10 text-warning", text: "Paiement en attente de confirmation. Cela peut prendre quelques minutes : utilisez « Vérifier » dans la liste des paiements." },
    CANCELED: { tone: "border-border bg-muted text-muted-foreground", text: "Paiement annulé : aucun montant n'a été débité." },
    FAILED: { tone: "border-destructive/40 bg-destructive/10 text-destructive", text: "Le paiement a échoué ou n'a pas pu être confirmé. Vous pouvez réessayer." },
  }[status] ?? { tone: "border-border bg-muted text-muted-foreground", text: "État du paiement indisponible." };
  return <p role="status" className={cn("rounded-lg border px-4 py-3 text-sm", m.tone)}>{m.text}</p>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
