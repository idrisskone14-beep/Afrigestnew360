import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/core/tenant/guards";
import { enumParam, type SearchParams } from "@/lib/list-params";
import { budgetGrid } from "@/modules/finance/reports";
import { BudgetGrid } from "@/modules/finance/ui/budget-grid";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("finance.budget.read");
  const sp = await searchParams;
  const now = new Date().getFullYear();
  const year = Number(enumParam(sp, "annee", [String(now - 1), String(now), String(now + 1)] as const) ?? now);
  const rows = await budgetGrid(ctx, year);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">Budget mensuel par catégorie de dépense, comparé aux sorties de trésorerie catégorisées (dépenses payées et mouvements saisis).</p>
        {[now - 1, now, now + 1].map((y) => <Button key={y} variant={y === year ? "default" : "outline"} size="sm" asChild><Link href={`/app/finance/budgets?annee=${y}`} aria-current={y === year ? "page" : undefined}>{y}</Link></Button>)}
      </div>
      <BudgetGrid key={year} year={year} rows={rows} currency={ctx.company.currency} canManage={ctx.can("finance.budget.manage")} />
    </div>
  );
}
