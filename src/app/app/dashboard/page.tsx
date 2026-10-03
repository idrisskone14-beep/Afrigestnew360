import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpenCheck, Boxes, CalendarClock, HandCoins, HardHat, KanbanSquare, Landmark, Receipt, Target, TrendingUp, Truck, Users, UsersRound, Wallet, type LucideIcon,
} from "lucide-react";
import { BarsChart } from "@/components/app/bars-chart";
import { CashflowChart } from "@/components/app/cashflow-chart";
import { AnimatedValue } from "@/components/app/animated-value";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { cn } from "@/lib/utils";
import { getLayout } from "@/modules/dashboard/layout";
import { CustomizeDialog } from "@/modules/dashboard/ui/customize-dialog";
import { WIDGET_BY_KEY, type ListItem, type WidgetData, type WidgetDef } from "@/modules/dashboard/widgets";

export const metadata: Metadata = { title: "Tableau de bord" };

const ICONS: Record<string, LucideIcon> = { Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpenCheck, Boxes, CalendarClock, HandCoins, HardHat, KanbanSquare, Landmark, Receipt, Target, TrendingUp, Truck, Users, UsersRound, Wallet };
// Palette des pastilles d'icônes : une couleur par indicateur, stable d'une visite à l'autre
const CHIPS = [
  { rule: "bg-forest", icon: "text-forest dark:text-brand-green" },
  { rule: "bg-brand", icon: "text-brand" },
  { rule: "bg-brand-2", icon: "text-warning" },
  { rule: "bg-brand-green", icon: "text-brand-green" },
  { rule: "bg-[#7a4a7c]", icon: "text-[#7a4a7c] dark:text-[#c08ac2]" },
  { rule: "bg-[#1f6b8f]", icon: "text-[#1f6b8f] dark:text-[#6bb6d9]" },
] as const;
const chip = (i: number) => CHIPS[i % CHIPS.length]!;
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
      <section className="relative mb-8 overflow-hidden rounded-xl border border-foreground/20 bg-forest text-[#f5eedf] shadow-offset-lg">
        <div className="motif-strip" aria-hidden />
        <div className="pattern-mudcloth pattern-drift pointer-events-none absolute inset-x-0 bottom-0 top-[10px] opacity-90" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-4 p-6 sm:p-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Bonjour, <span className="italic text-brand-2">{ctx.user.name.split(" ")[0]}</span></h1>
            <p className="mt-3 max-w-xl text-sm text-[#f5eedf]/80">Vue d'ensemble de <span className="font-semibold text-white">{name}</span> — indicateurs selon vos modules et vos droits.</p>
          </div>
          <CustomizeDialog initial={layout.map((l) => ({ key: l.key, title: WIDGET_BY_KEY.get(l.key)!.title, visible: l.visible }))} />
        </div>
      </section>
      {loaded.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Aucun widget affiché. Utilisez « Personnaliser » pour en ajouter, ou demandez l'accès à un module à votre administrateur.</CardContent></Card>}
      {kpis.length > 0 && (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(({ w, data, error }, i) => <KpiCard key={w.key} w={w} data={data} error={error} index={i} />)}
        </div>
      )}
      {panels.length > 0 && (
        <div className="stagger mt-6 grid gap-6 xl:grid-cols-2">
          {panels.map(({ w, data, error }, pi) => (
            <Card key={w.key} className={cn(w.size === "wide" && "xl:col-span-2")}>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2.5 font-display text-lg font-semibold">{(() => { const I = ICONS[w.icon]; return I ? <span className={cn("grid size-8 place-items-center rounded-md border-2 border-current", chip(pi + 2).icon)}><I className="size-4" aria-hidden /></span> : null; })()}{w.title}</CardTitle></CardHeader>
              <CardContent>{error || !data ? <p className="text-sm text-muted-foreground">Ce widget n'a pas pu être chargé.</p> : <Panel data={data} currency={ctx.company.currency} />}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function KpiCard({ w, data, error, index }: { w: WidgetDef; data: WidgetData | null; error: boolean; index: number }) {
  const I = ICONS[w.icon];
  const k = data?.kind === "kpi" ? data : null;
  const body = (
    <Card className="group/kpi relative h-full gap-0 overflow-hidden py-0">
      <div className={cn("h-1.5 w-full origin-left animate-weave", chip(index).rule)} aria-hidden />
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{w.title}</span>
          {I && <span className={cn("grid size-8 shrink-0 place-items-center rounded-md border-2 border-current transition-transform duration-300 group-hover/kpi:rotate-6", chip(index).icon)}><I className="size-4" aria-hidden /></span>}
        </div>
        {k ? (
          <>
            <div className={cn("truncate font-display text-3xl font-semibold tracking-tight tabular", k.tone && TONE[k.tone])}><AnimatedValue value={k.value} /></div>
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
