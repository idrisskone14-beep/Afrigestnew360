import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { balanceSheet, defaultFiscalYear, incomeStatement, type StatementGroup } from "@/modules/accounting/reports";
import { listFiscalYears } from "@/modules/accounting/service";
import { YearSwitch } from "@/modules/accounting/ui/year-switch";

export const metadata: Metadata = { title: "États financiers" };

export default async function StatementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("accounting.ledger.read");
  const sp = await searchParams;
  const years = await listFiscalYears(ctx);
  const fy = await defaultFiscalYear(ctx, years.find((y) => y.id === param(sp, "exercice"))?.id);
  if (!fy) return null;
  const [is, bs] = await Promise.all([incomeStatement(ctx, { fiscalYearId: fy.id }), balanceSheet(ctx, { fiscalYearId: fy.id })]);
  const cur = ctx.company.currency;
  const m = (n: number) => formatMoney(n, cur);

  return (
    <div className="space-y-6">
      <YearSwitch years={years} current={fy.id} basePath="/app/accounting/etats" />
      <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">États <strong>simplifiés</strong>, construits directement à partir des soldes de vos comptes (classes 1 à 8). Ils ne remplacent pas la liasse officielle (bilan, compte de résultat et tableau des flux SYSCOHADA) établie et validée par votre expert-comptable.</p>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Compte de résultat — {fy.name}</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <Block title="Produits" groups={is.products} total={is.totalProducts.toNumber()} cur={cur} />
            <Block title="Charges" groups={is.charges} total={is.totalCharges.toNumber()} cur={cur} />
            <div className="space-y-1 border-t pt-3 text-sm">
              <Line label="Résultat d'exploitation (produits − charges)" value={m(is.operating.toNumber())} />
              {!is.hao.isZero() && <Line label="Résultat hors activités ordinaires" value={m(is.hao.toNumber())} />}
              <Line label={is.result.gte(0) ? "Résultat net : bénéfice" : "Résultat net : perte"} value={m(is.result.toNumber())} bold tone={is.result.lt(0) ? "danger" : "success"} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Bilan — {fy.name}</CardTitle></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
            <List title="Actif" items={bs.assets} total={bs.totalAssets.toNumber()} cur={cur} />
            <List title="Passif" items={bs.liabilities} total={bs.totalLiabilities.toNumber()} cur={cur} />
            <p className={`text-xs sm:col-span-2 xl:col-span-1 ${bs.totalAssets.eq(bs.totalLiabilities) ? "text-muted-foreground" : "font-medium text-destructive"}`}>{bs.totalAssets.eq(bs.totalLiabilities) ? "Actif = passif : le bilan est équilibré." : "Actif ≠ passif : anomalie à investiguer."}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "danger" | "success" }) {
  return <div className={`flex justify-between gap-4 ${bold ? "text-base font-semibold" : ""} ${tone === "danger" ? "text-destructive" : tone === "success" ? "text-success" : ""}`}><span className={bold || tone ? "" : "text-muted-foreground"}>{label}</span><span className="tabular">{value}</span></div>;
}

function Block({ title, groups, total, cur }: { title: string; groups: StatementGroup[]; total: number; cur: string }) {
  return (
    <section aria-label={title}>
      <h4 className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>{title}</span><span className="tabular">{formatMoney(total, cur)}</span></h4>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">Aucun mouvement.</p>}
      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.key}>
            <div className="flex justify-between text-sm font-medium"><span>{g.key} — {g.label}</span><span className="tabular">{formatMoney(g.total.toNumber(), cur)}</span></div>
            <ul className="ml-4 border-l pl-3">{g.rows.map((r) => <li key={r.code} className="flex justify-between text-xs text-muted-foreground"><span>{r.code} {r.name}</span><span className="tabular">{formatMoney(r.amount.toNumber(), cur)}</span></li>)}</ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function List({ title, items, total, cur }: { title: string; items: { code: string; name: string; amount: { toNumber(): number } }[]; total: number; cur: string }) {
  return (
    <section aria-label={title}>
      <h4 className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>{title}</span><span className="tabular">{formatMoney(total, cur)}</span></h4>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Aucun solde.</p>}
      <ul className="space-y-0.5">{items.map((r) => <li key={`${r.code}-${r.name}`} className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate"><span className="font-medium">{r.code}</span> <span className="text-muted-foreground">{r.name}</span></span><span className="tabular">{formatMoney(r.amount.toNumber(), cur)}</span></li>)}</ul>
    </section>
  );
}
