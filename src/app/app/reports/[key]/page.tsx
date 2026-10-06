import type { Metadata } from "next";
import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { Download } from "lucide-react";
import { BarsChart } from "@/components/app/lazy-charts";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AppError } from "@/core/errors";
import { requireModulePage } from "@/core/tenant/guards";
import { PRINT_ONLY_CLASS } from "@/lib/print";
import { buildQuery, param, type SearchParams } from "@/lib/list-params";
import { REPORT_BY_KEY } from "@/modules/reports/catalog";
import { FILTER_PARAMS, isoDay } from "@/modules/reports/filters";
import { buildReport, canRunReport, filterOptions } from "@/modules/reports/service";
import { PrintButton } from "@/modules/reports/ui/print-button";
import { ReportTable } from "@/modules/reports/ui/report-table";
import type { FilterKey } from "@/modules/reports/types";

const LABELS: Record<Exclude<FilterKey, "period">, string> = { branch: "Agence", department: "Département", user: "Utilisateur", customer: "Client", supplier: "Fournisseur", project: "Projet", costCenter: "Centre de coûts" };
const selectCls = "h-9 max-w-52 rounded-md border bg-background px-2 text-sm";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: REPORT_BY_KEY.get(key)?.title ?? "Rapport" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("reports");
  const { key } = await params;
  const def = REPORT_BY_KEY.get(key);
  if (!def) notFound();
  if (!canRunReport(ctx, def)) forbidden();
  const sp = await searchParams;
  const { filters, result } = await buildReport(ctx, key, (k) => param(sp, k)).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const options = await filterOptions(ctx, def.filters);
  const canExport = ctx.can("reports.export.run");
  const exportQuery = (format: string) => `/api/reports/${key}/export${buildQuery(sp, { format })}`;
  const t = result.table;

  return (
    <>
      <PageHeader
        title={def.title}
        description={def.description}
        breadcrumbs={[{ label: "Rapports", href: "/app/reports" }, { label: def.title }]}
        actions={<div className="flex flex-wrap items-center gap-2 print:hidden">
          {canExport && (["xlsx", "csv", "pdf"] as const).map((f) => <Button key={f} asChild variant="outline" size="sm"><a href={exportQuery(f)}><Download className="size-4" /> {f === "xlsx" ? "Excel" : f.toUpperCase()}</a></Button>)}
          <PrintButton />
        </div>}
      />

      <form method="get" role="search" aria-label="Filtres du rapport" className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
        {def.filters.includes("period") && (<>
          <label className="grid gap-1 text-xs text-muted-foreground">Du<Input type="date" name="du" defaultValue={filters.from ? isoDay(filters.from) : ""} className="h-9" /></label>
          <label className="grid gap-1 text-xs text-muted-foreground">Au<Input type="date" name="au" defaultValue={filters.to ? isoDay(new Date(filters.to.getTime() - 86_400_000)) : ""} className="h-9" /></label>
        </>)}
        {def.filters.filter((k): k is Exclude<FilterKey, "period"> => k !== "period").map((k) => {
          const name = FILTER_PARAMS[k];
          const current = param(sp, name) ?? "";
          return (
            <label key={k} className="grid gap-1 text-xs text-muted-foreground">{LABELS[k]}
              <select name={name} defaultValue={current} className={selectCls}><option value="">Tous</option>{(options[k] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
            </label>
          );
        })}
        {def.option && (
          <label className="grid gap-1 text-xs text-muted-foreground">{def.option.label}
            <select name="vue" defaultValue={filters.view} className={selectCls}>{def.option.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
          </label>
        )}
        <Button type="submit" size="sm">Appliquer</Button>
        <Button asChild variant="ghost" size="sm"><Link href={`/app/reports/${key}`}>Réinitialiser</Link></Button>
      </form>

      <div className={PRINT_ONLY_CLASS}>
        <p className="text-lg font-semibold">{def.title} — {t.company}</p>
        {t.filters?.map(([k, v]) => <p key={k} className="text-sm">{k} : {v}</p>)}
      </div>

      <div className="space-y-6">
        {t.filters && t.filters.length > 0 && <p className="text-sm text-muted-foreground print:hidden">{t.filters.map(([k, v]) => `${k} : ${v}`).join(" · ")}</p>}
        {result.summary.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {result.summary.map((s) => <Card key={s.label} className="p-4"><p className="text-xs text-muted-foreground">{s.label}</p><p className="mt-1 truncate text-xl font-semibold tracking-tight tabular">{s.value}</p></Card>)}
          </div>
        )}
        {result.chart && result.chart.data.some((d) => d.value !== 0) && <Card className="p-4 print:break-inside-avoid"><BarsChart data={result.chart.data} currency={ctx.company.currency} seriesLabel={result.chart.seriesLabel} /></Card>}
        {result.truncated && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Résultat tronqué à 5 000 lignes : affinez les filtres (période, client…) pour obtenir le détail complet.</p>}
        <ReportTable table={t} />
        <p className="text-xs text-muted-foreground print:hidden">Données de l&apos;entreprise active, selon vos droits d&apos;accès. Les exports reprennent exactement ce tableau.</p>
      </div>
    </>
  );
}
