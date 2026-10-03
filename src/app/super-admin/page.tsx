import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Inbox, TrendingUp, UserCheck, Users, PauseCircle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/reference-data";
import { getPlatformStats } from "@/modules/platform/stats";
import { PlatformCharts } from "./platform-charts";

export const metadata: Metadata = { title: "Vue d'ensemble" };

const dt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const STATUS_LABEL: Record<string, string> = { TRIALING: "Essai", ACTIVE: "Actifs", PAST_DUE: "Impayés", CANCELED: "Résiliés" };

export default async function PlatformDashboard() {
  const s = await getPlatformStats();
  const main = s.recurring.find((r) => r.currency === "XOF") ?? s.recurring[0];

  return (
    <>
      <PageHeader title="Vue d'ensemble de la plateforme" description="Entreprises, utilisateurs, abonnements et activité globale." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Building2 className="size-4" />} label="Entreprises" value={s.companiesTotal} hint={`${s.companiesActive} actives · +${s.newCompanies30} sur 30 j`} href="/super-admin/entreprises" />
        <Kpi icon={<PauseCircle className="size-4" />} label="Suspendues" value={s.companiesSuspended} hint="Accès bloqué" href="/super-admin/entreprises?statut=SUSPENDED" />
        <Kpi icon={<Users className="size-4" />} label="Utilisateurs" value={s.usersTotal} hint={`+${s.newUsers30} nouveaux comptes (30 j)`} />
        <Kpi icon={<UserCheck className="size-4" />} label="Utilisateurs actifs (30 j)" value={s.usersActive30} hint="Connectés dans le mois" />
        <Kpi icon={<TrendingUp className="size-4" />} label="MRR" text={main ? formatMoney(main.mrr, main.currency) : "—"} hint="Abonnements actifs, hors essais" />
        <Kpi icon={<TrendingUp className="size-4" />} label="ARR" text={main ? formatMoney(main.arr, main.currency) : "—"} hint="MRR × 12" />
        <Kpi icon={<Inbox className="size-4" />} label="Demandes de démo" value={s.demoNew} hint={`${s.demoTotal} au total`} href="/super-admin/demandes" />
        <Card>
          <CardContent className="space-y-1.5 p-5">
            <p className="text-sm text-muted-foreground">Abonnements</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(s.subscriptionsByStatus).map(([k, v]) => <Badge key={k} variant="secondary">{STATUS_LABEL[k] ?? k} : {v}</Badge>)}
              {Object.keys(s.subscriptionsByStatus).length === 0 && <span className="text-sm text-muted-foreground">Aucun</span>}
            </div>
            <p className="text-xs text-muted-foreground">{Object.entries(s.subscriptionsByPlan).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
          </CardContent>
        </Card>
      </div>

      <PlatformCharts signups={s.signupSeries} modules={s.topModules} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Dernières entreprises</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {s.recentCompanies.map((c) => (
              <Link key={c.id} href={`/super-admin/entreprises/${c.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{c.tradeName ?? c.legalName}</p><p className="text-xs text-muted-foreground">{c.country} · {dt.format(c.createdAt)}</p></div>
                <Badge variant={c.status === "ACTIVE" ? "secondary" : "destructive"}>{c.status === "ACTIVE" ? "Active" : "Suspendue"}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Activité globale</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {s.recentActivity.length === 0 && <p className="px-6 py-6 text-sm text-muted-foreground">Aucune activité enregistrée.</p>}
            {s.recentActivity.map((a) => (
              <div key={a.id} className="px-6 py-3">
                <p className="text-sm">{a.summary ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{a.company?.legalName ?? "Plateforme"} · {dt.format(a.createdAt)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Kpi({ icon, label, value, text, hint, href }: { icon: React.ReactNode; label: string; value?: number; text?: string; hint?: string; href?: string }) {
  const body = (
    <Card className={href ? "transition-colors hover:border-brand/50" : undefined}>
      <CardContent className="space-y-1 p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
        <div className="truncate text-2xl font-semibold tracking-tight tabular">{text ?? value}</div>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
