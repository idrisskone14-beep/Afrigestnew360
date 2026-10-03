import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpenCheck, Boxes, CalendarClock, HandCoins, HardHat, KanbanSquare, Landmark, Receipt, Target, TrendingUp, Truck, Users, UsersRound, Wallet, type LucideIcon,
} from "lucide-react";
import { BarsChart } from "@/components/app/bars-chart";
import { CashflowChart } from "@/components/app/cashflow-chart";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { cn } from "@/lib/utils";
import { getLayout } from "@/modules/dashboard/layout";
import { CustomizeDialog } from "@/modules/dashboard/ui/customize-dialog";
import { WIDGET_BY_KEY, type ListItem, type WidgetData, type WidgetDef } from "@/modules/dashboard/widgets";

export const metadata: Metadata = { title: "Tableau de bord" };

const ICONS: Record<string, LucideIcon> = { Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpenCheck, Boxes, CalendarClock, HandCoins, HardHat, KanbanSquare, Landmark, Receipt, Target, TrendingUp, Truck, Users, UsersRound, Wallet };
const TONE = { danger: "text-destructive", warning: "text-warning", success: "text-success" } as const;

export default async function DashboardPage() {
  const ctx = await requireTenantContext();
  const layout = await getLayout(ctx);
  const visible = layout.filter((l) => l.visible).map((l) => WIDGET_BY_KEY.get(l.key)!).filter(Boolean);
  // chaque widget se charge indépendamment : l'échec de l'un n'empêche pas l'affichage des autres
  const loaded = await Promise.all(visible.map(async (w) => {
    try { return { w, data: await w.load(ctx), error: false as const }; }
    catch (e) { console.error(`[dashboard:${w.key}]`, e); return { w, data: null, error: true as const }; }
  }));
  const kpis = loaded.filter((x) => x.w.size === "kpi");
  const panels = loaded.filter((x) => x.w.size !== "kpi");
  const name = ctx.company.tradeName ?? ctx.company.legalName;

  return (
    <>
      <PageHeader title={`Bonjour ${ctx.user.name.split(" ")[0]}`} description={`Vue d'ensemble de ${name} — indicateurs selon vos modules et vos droits.`} actions={<CustomizeDialog initial={layout.map((l) => ({ key: l.key, title: WIDGET_BY_KEY.get(l.key)!.title, visible: l.visible }))} />} />
      {loaded.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Aucun widget affiché. Utilisez « Personnaliser » pour en ajouter, ou demandez l'accès à un module à votre administrateur.</CardContent></Card>}
      {kpis.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(({ w, data, error }) => <KpiCard key={w.key} w={w} data={data} error={error} />)}
        </div>
      )}
      {panels.length > 0 && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          {panels.map(({ w, data, error }) => (
            <Card key={w.key} className={cn(w.size === "wide" && "xl:col-span-2")}>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">{(() => { const I = ICONS[w.icon]; return I ? <I className="size-4 text-muted-foreground" aria-hidden /> : null; })()}{w.title}</CardTitle></CardHeader>
              <CardContent>{error || !data ? <p className="text-sm text-muted-foreground">Ce widget n'a pas pu être chargé.</p> : <Panel data={data} currency={ctx.company.currency} />}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function KpiCard({ w, data, error }: { w: WidgetDef; data: WidgetData | null; error: boolean }) {
  const I = ICONS[w.icon];
  const k = data?.kind === "kpi" ? data : null;
  const body = (
    <Card className={cn("h-full transition-colors", k?.href && "hover:border-brand/50")}>
      <CardContent className="space-y-1 p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{I && <I className="size-4" aria-hidden />}{w.title}</div>
        {k ? (
          <>
            <div className={cn("truncate text-xl font-semibold tracking-tight tabular 2xl:text-2xl", k.tone && TONE[k.tone])}>{k.value}</div>
            {k.hint && <p className="truncate text-xs text-muted-foreground">{k.hint}</p>}
          </>
        ) : <p className="text-sm text-muted-foreground">{error ? "Indisponible" : "—"}</p>}
      </CardContent>
    </Card>
  );
  return k?.href ? <Link href={k.href} className="block">{body}</Link> : body;
}

function Panel({ data, currency }: { data: WidgetData; currency: string }) {
  if (data.kind === "bars") return <BarsChart data={data.data} currency={currency} seriesLabel={data.seriesLabel} />;
  if (data.kind === "cashflow") return <CashflowChart data={data.data} currency={currency} />;
  if (data.kind === "list") return <ListPanel items={data.items} empty={data.empty} />;
  return null;
}

function ListPanel({ items, empty }: { items: ListItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="-mx-2 divide-y">
      {items.map((it, i) => {
        const row = (
          <div className="flex items-center gap-3 px-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", it.tone ? cn("font-medium", TONE[it.tone]) : "")}>{it.label}</p>
              {it.sub && <p className="truncate text-xs text-muted-foreground">{it.sub}</p>}
            </div>
            {it.value && <span className="tabular shrink-0 text-sm">{it.value}</span>}
          </div>
        );
        return <li key={`${it.label}-${i}`}>{it.href ? <Link href={it.href} className="block rounded-md hover:bg-muted/50">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}
