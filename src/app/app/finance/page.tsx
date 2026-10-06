import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Landmark, TrendingUp } from "lucide-react";
import { CashflowChart } from "@/components/app/lazy-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { formatMoney } from "@/lib/reference-data";
import { cashForecast, monthlyCashflow } from "@/modules/finance/reports";
import { listAccounts } from "@/modules/finance/treasury";

export const metadata: Metadata = { title: "Finance" };
const TYPE_LABEL = { BANK: "Banque", CASH: "Caisse", MOBILE_MONEY: "Mobile money" } as const;

export default async function FinanceOverview() {
  const ctx = await requireTenantContext();
  const canAccounts = ctx.can("finance.account.read");
  const cur = ctx.company.currency;
  const [accounts, flow, forecast, pendingExpenses] = await Promise.all([
    canAccounts ? listAccounts(ctx) : Promise.resolve([]),
    canAccounts ? monthlyCashflow(ctx, 6) : Promise.resolve([]),
    canAccounts ? cashForecast(ctx) : Promise.resolve(null),
    ctx.can("finance.expense.read") ? ctx.db.expense.aggregate({ where: { status: { in: ["APPROVED"] } }, _count: true, _sum: { amount: true } }) : Promise.resolve(null),
  ]);
  const total = accounts.reduce((a, b) => a + b.balance.toNumber(), 0);
  const thisMonth = flow.at(-1);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canAccounts && <Kpi icon={<Landmark className="size-4" />} label="Trésorerie totale" value={formatMoney(total, cur)} hint={`${accounts.length} compte${accounts.length > 1 ? "s" : ""}`} href="/app/finance/comptes" />}
        {thisMonth && <Kpi icon={<ArrowDownLeft className="size-4" />} label="Encaissé ce mois" value={formatMoney(thisMonth.inflow, cur)} href="/app/finance/mouvements" />}
        {thisMonth && <Kpi icon={<ArrowUpRight className="size-4" />} label="Décaissé ce mois" value={formatMoney(thisMonth.outflow, cur)} href="/app/finance/mouvements" />}
        {forecast && <Kpi icon={<TrendingUp className="size-4" />} label="Prévisionnel à 30 jours" value={formatMoney(forecast.points[0]!.balance, cur)} hint="Solde + créances − dettes échues" tone={forecast.points[0]!.balance < 0 ? "danger" : undefined} href="/app/finance/echeancier" />}
        {pendingExpenses && pendingExpenses._count > 0 && <Kpi icon={<ArrowUpRight className="size-4" />} label="Dépenses à payer" value={String(pendingExpenses._count)} hint="Approuvées, en attente de règlement" href="/app/finance/depenses?statut=APPROVED" />}
      </div>

      {canAccounts && (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader><CardTitle className="text-base">Flux de trésorerie — 6 derniers mois</CardTitle></CardHeader>
            <CardContent><CashflowChart data={flow} currency={cur} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Soldes par compte</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
              {accounts.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun compte.</p>}
              {accounts.map((a) => (
                <Link key={a.id} href={`/app/finance/mouvements?compte=${a.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{a.name}</p><p className="text-xs text-muted-foreground">{TYPE_LABEL[a.type]}</p></div>
                  <span className={`tabular text-sm ${a.balance.lt(0) ? "text-destructive" : ""}`}>{formatMoney(a.balance.toNumber(), cur)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint, href, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; href: string; tone?: "danger" }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-brand/50">
        <CardContent className="space-y-1 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
          <div className={`truncate text-xl font-semibold tracking-tight tabular 2xl:text-2xl ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}
