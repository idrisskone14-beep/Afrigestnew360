import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowLeftRight, ArrowUpRight, BarChart3, BookOpenCheck, Boxes, Camera, CalendarClock, ClipboardList, FileText, HandCoins, HardHat, KanbanSquare, Landmark, Receipt, ShoppingBag, ShoppingCart, Target, TrendingUp, Truck, Users, UsersRound, Wallet, type LucideIcon,
} from "lucide-react";
import { AreaTrendChart, BarsChart, CashflowChart, DonutChart } from "@/components/app/lazy-charts";
import { AnimatedValue } from "@/components/app/animated-value";
import { HBarsChart } from "@/components/app/hbars-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { quickActionsFor, type QuickAction } from "@/core/tenant/quick-actions";
import { cn } from "@/lib/utils";
import { CustomerFormDialog } from "@/modules/crm/ui/customer-form";
import { getLayout } from "@/modules/dashboard/layout";
import { loadWidgets } from "@/modules/dashboard/load";
import { CustomizeDialog } from "@/modules/dashboard/ui/customize-dialog";
import { WIDGET_BY_KEY, type ListItem, type WidgetData, type WidgetDef } from "@/modules/dashboard/widgets";

export const metadata: Metadata = { title: "Tableau de bord" };

const ICONS: Record<string, LucideIcon> = { Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpenCheck, Boxes, CalendarClock, HandCoins, HardHat, KanbanSquare, Landmark, Receipt, Target, TrendingUp, Truck, Users, UsersRound, Wallet };
const ACTION_ICONS: Partial<Record<QuickAction["icon"], LucideIcon>> = { FileText, Receipt, ShoppingBag, ShoppingCart, ClipboardList, Camera };
const TONE = { danger: "text-destructive", warning: "text-warning", success: "text-success" } as const;

export default async function DashboardPage() {
  const ctx = await requireTenantContext();
  const layout = await getLayout(ctx);
  const visible = layout.filter((l) => l.visible).map((l) => WIDGET_BY_KEY.get(l.key)!).filter(Boolean);
  // widgets regroupés en 5 transactions parallèles (voir load.ts) ; l'échec de l'un n'empêche pas l'affichage des autres
  const loaded = await loadWidgets(ctx, visible);
  const kpis = loaded.filter((x) => x.w.size === "kpi");
  const panels = loaded.filter((x) => x.w.size !== "kpi");
  const name = ctx.company.tradeName ?? ctx.company.legalName;
  // mêmes gestes rapides que le bouton « + » du mobile (module actif ET permission) ; le scanner n'a de sens que sur téléphone
  const actions = quickActionsFor(ctx).filter((a) => a.href);
  const canCreateCustomer = ctx.hasModule("crm") && ctx.can("crm.customer.create");

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div className="min-w-0">
          <p className="eyebrow">{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Tableau de bord</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bonjour {ctx.user.name.split(" ")[0]}, voici la situation de <span className="font-medium text-foreground">{name}</span>.</p>
        </div>
        <CustomizeDialog initial={layout.map((l) => ({ key: l.key, title: WIDGET_BY_KEY.get(l.key)!.title, visible: l.visible }))} />
      </header>
      {(actions.length > 0 || canCreateCustomer) && (
        <nav aria-label="Actions rapides" className="mb-6 hidden flex-wrap items-center gap-2 lg:flex">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Actions rapides</span>
          {actions.map((a) => {
            const I = ACTION_ICONS[a.icon];
            return <Button key={a.key} asChild variant="outline"><Link href={a.href!}>{I && <I className="size-4" aria-hidden />}{a.label}</Link></Button>;
          })}
          {canCreateCustomer && <CustomerFormDialog defaultCountry={ctx.company.country} />}
        </nav>
      )}
      {loaded.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Aucun widget affiché. Utilisez « Personnaliser » pour en ajouter, ou demandez l'accès à un module à votre administrateur.</CardContent></Card>}
      {kpis.length > 0 && (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(({ w, data, error }) => <KpiCard key={w.key} w={w} data={data} error={error} />)}
        </div>
      )}
      {panels.length > 0 && (
        <div className="stagger mt-6 grid grid-flow-dense gap-4 md:grid-cols-2 xl:grid-cols-3">
          {panels.map(({ w, data, error }) => (
            <Card key={w.key} className={cn("gap-0 overflow-hidden py-0", w.size === "wide" && "md:col-span-2")}>
              <div className="border-b px-5 py-3.5">
                <h2 className="text-sm font-semibold leading-tight">{w.title}</h2>
                {w.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{w.subtitle}</p>}
              </div>
              <CardContent className="p-5">{error || !data ? <p className="text-sm text-muted-foreground">Ce widget n'a pas pu être chargé.</p> : <Panel w={w} data={data} currency={ctx.company.currency} />}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** Indicateur clé : libellé, valeur lisible en entier (jamais tronquée), variation et précision. */
function KpiCard({ w, data, error }: { w: WidgetDef; data: WidgetData | null; error: boolean }) {
  const I = ICONS[w.icon];
  const k = data?.kind === "kpi" ? data : null;
  const delta = k?.delta;
  const body = (
    <Card className="h-full gap-0 py-0 transition-shadow hover:shadow-offset">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">{w.title}</span>
          {I && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><I className="size-4" aria-hidden /></span>}
        </div>
        {k ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className={cn("whitespace-nowrap font-display text-[clamp(1.35rem,1.8vw,1.75rem)] font-semibold leading-none tracking-tight tabular", k.tone && TONE[k.tone])} title={k.value}><AnimatedValue value={k.value} /></span>
              {delta !== undefined && delta !== null && (
                <span title={k.deltaLabel} className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium", delta >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                  {delta >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                  {delta >= 0 ? "+" : ""}{delta} %{k.deltaLabel && <span className="sr-only"> {k.deltaLabel}</span>}
                </span>
              )}
            </div>
            {k.hint && <p className="line-clamp-2 text-xs text-muted-foreground">{k.hint}</p>}
          </>
        ) : <p className="text-sm text-muted-foreground">{error ? "Indisponible" : "—"}</p>}
      </CardContent>
    </Card>
  );
  return k?.href ? <Link href={k.href} className="block">{body}</Link> : body;
}

function Panel({ w, data, currency }: { w: WidgetDef; data: WidgetData; currency: string }) {
  if (data.kind === "bars") return <BarsChart data={data.data} currency={currency} seriesLabel={data.seriesLabel} />;
  if (data.kind === "cashflow") return <CashflowChart data={data.data} currency={currency} />;
  if (data.kind === "area") return <AreaTrendChart data={data.data} currency={currency} seriesLabel={data.seriesLabel} previousLabel={data.previousLabel} />;
  if (data.kind === "donut") return data.items.length === 0 ? <Empty text={data.empty} /> : <DonutChart items={data.items} currency={currency} label={w.title} />;
  if (data.kind === "hbars") return data.items.length === 0 ? <Empty text={data.empty} /> : <HBarsChart items={data.items} groups={data.groups} currency={currency} label={w.title} />;
  if (data.kind === "list") return <ListPanel items={data.items} empty={data.empty} />;
  return null;
}

const Empty = ({ text }: { text: string }) => <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;

function ListPanel({ items, empty }: { items: ListItem[]; empty: string }) {
  if (items.length === 0) return <Empty text={empty} />;
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
