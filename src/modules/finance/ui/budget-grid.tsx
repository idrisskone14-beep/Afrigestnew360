"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runAction } from "@/components/app/form-kit";
import { formatMoney } from "@/lib/reference-data";
import { saveBudgetAction } from "../actions";

const MONTHS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
export interface BudgetRowData { categoryId: string; name: string; budget: number[]; actual: number[] }

/** Budget mensuel par catégorie de dépense, comparé au réalisé (sorties de trésorerie catégorisées). */
export function BudgetGrid({ year, rows, currency, canManage }: { year: number; rows: BudgetRowData[]; currency: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string[]>>(() => Object.fromEntries(rows.map((r) => [r.categoryId, r.budget.map((b) => (b ? String(b) : ""))])));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const set = (cat: string, i: number, v: string) => { setValues((s) => ({ ...s, [cat]: s[cat]!.map((x, j) => (j === i ? v : x)) })); setDirty((d) => new Set(d).add(cat)); };
  const save = (cat: string) => start(async () => {
    const r = await runAction(saveBudgetAction({ year, categoryId: cat, months: values[cat]!.map((v) => Number(v || 0)) }), { success: "Budget enregistré" });
    if (r.ok) { setDirty((d) => { const n = new Set(d); n.delete(cat); return n; }); router.refresh(); }
  });
  const fill = (cat: string, annual: string) => { const m = Math.round(Number(annual || 0) / 12); setValues((s) => ({ ...s, [cat]: Array(12).fill(m ? String(m) : "") })); setDirty((d) => new Set(d).add(cat)); };

  return (
    <div className="space-y-4">
      {rows.map((r) => {
        const budgetTotal = values[r.categoryId]!.reduce((a, v) => a + Number(v || 0), 0);
        const actualTotal = r.actual.reduce((a, b) => a + b, 0);
        const over = budgetTotal > 0 && actualTotal > budgetTotal;
        return (
          <Card key={r.categoryId} className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h3 className="flex-1 text-sm font-semibold">{r.name}</h3>
              <p className="text-xs text-muted-foreground">Budget {formatMoney(budgetTotal, currency)} · Réalisé <span className={over ? "font-medium text-destructive" : "text-foreground"}>{formatMoney(actualTotal, currency)}</span>{budgetTotal > 0 && ` (${Math.round((actualTotal / budgetTotal) * 100)} %)`}</p>
              {canManage && <Button size="sm" disabled={pending || !dirty.has(r.categoryId)} onClick={() => save(r.categoryId)}>Enregistrer</Button>}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12">
              {MONTHS.map((m, i) => {
                const b = Number(values[r.categoryId]![i] || 0);
                const a = r.actual[i]!;
                return (
                  <div key={m} className="grid gap-1">
                    <label htmlFor={`bg-${r.categoryId}-${i}`} className="text-[11px] text-muted-foreground">{m}</label>
                    <Input id={`bg-${r.categoryId}-${i}`} type="number" min={0} step="any" className="h-8 px-2 text-right text-xs" disabled={!canManage || pending} value={values[r.categoryId]![i]} onChange={(e) => set(r.categoryId, i, e.target.value)} placeholder="0" />
                    <span className={`text-right text-[11px] tabular ${b > 0 && a > b ? "font-medium text-destructive" : "text-muted-foreground"}`}>{a ? formatMoney(a, currency) : "—"}</span>
                  </div>
                );
              })}
            </div>
            {canManage && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <label htmlFor={`an-${r.categoryId}`}>Répartir un total annuel :</label>
                <Input id={`an-${r.categoryId}`} type="number" min={0} className="h-8 w-36 text-right text-xs" placeholder="ex. 1200000" onBlur={(e) => { if (e.target.value) { fill(r.categoryId, e.target.value); e.target.value = ""; } }} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
