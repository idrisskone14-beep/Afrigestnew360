"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LIMIT_KEYS, UNLIMITED } from "@/core/modules/registry";
import { formatMoney } from "@/lib/reference-data";
import { cn } from "@/lib/utils";

export interface PublicPlan {
  code: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  trialDays: number;
  modules: { key: string; name: string; kind: string }[];
  limits: Record<string, number>;
}

const HIGHLIGHT = "business";

export function PricingTable({ plans }: { plans: PublicPlan[] }) {
  const [yearly, setYearly] = useState(false);
  return (
    <div>
      <div className="mx-auto flex w-fit items-center gap-1 rounded-full border bg-card p-1 text-sm" role="group" aria-label="Période de facturation">
        <button type="button" onClick={() => setYearly(false)} aria-pressed={!yearly} className={cn("rounded-full px-4 py-1.5 font-medium transition-colors", !yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>Mensuel</button>
        <button type="button" onClick={() => setYearly(true)} aria-pressed={yearly} className={cn("rounded-full px-4 py-1.5 font-medium transition-colors", yearly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>Annuel <span className="text-brand-green">2 mois offerts</span></button>
      </div>
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {plans.map((p) => {
          const price = yearly ? p.priceYearly : p.priceMonthly;
          const featured = p.code === HIGHLIGHT;
          return (
            <div key={p.code} className={cn("relative flex flex-col rounded-2xl border bg-card p-7", featured && "border-brand shadow-xl shadow-brand/10")}>
              {featured && <Badge className="absolute -top-3 left-7 bg-brand text-brand-foreground hover:bg-brand">Le plus choisi</Badge>}
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">{p.description}</p>
              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight tabular">{formatMoney(price, p.currency)}</span>
                <span className="text-sm text-muted-foreground">/ {yearly ? "an" : "mois"}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{p.trialDays > 0 ? `${p.trialDays} jours d'essai gratuit` : "Sans période d'essai"} · hors taxes</p>
              <Button asChild size="lg" variant={featured ? "default" : "outline"} className="mt-6"><Link href={`/demo?offre=${p.code}`}>Demander une démo</Link></Button>
              <div className="mt-6 space-y-5 border-t pt-6 text-sm">
                <div>
                  <p className="mb-2 font-medium">Inclus</p>
                  <ul className="space-y-1.5">
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />Tableau de bord, utilisateurs, rôles, audit</li>
                    {p.modules.map((m) => <li key={m.key} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />{m.name}{m.kind === "EXTENSION" && <span className="text-xs text-muted-foreground">(extension)</span>}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 font-medium">Limites</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {LIMIT_KEYS.filter((l) => (p.limits[l.key] ?? UNLIMITED) !== 0).map((l) => {
                      const v = p.limits[l.key] ?? UNLIMITED;
                      return <li key={l.key} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular text-foreground">{v === UNLIMITED ? "Illimité" : l.key === "storage_mb" ? `${v >= 1024 ? v / 1024 + " Go" : v + " Mo"}` : v.toLocaleString("fr-FR")}</span></li>;
                    })}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
