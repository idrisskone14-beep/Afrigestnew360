"use client";

import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/reference-data";
import { CATEGORY_COLORS, OTHER_COLOR } from "./chart-utils";

export interface DonutItem { label: string; value: number; href?: string }

const colorOf = (item: DonutItem, index: number) => (item.label === "Autres" || index >= CATEGORY_COLORS.length ? OTHER_COLOR : CATEGORY_COLORS[index]!);

/**
 * Répartition en parts d'un tout : anneau (2 px de marge entre les parts) avec le total au centre, et légende chiffrée à côté
 * (valeur et pourcentage de chaque catégorie) : la légende tient lieu de vue tableau, et l'identité ne dépend jamais de la couleur seule.
 */
export function DonutChart({ items, currency, label }: { items: DonutItem[]; currency: string; label: string }) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return (
    <figure aria-label={label} className="flex flex-col items-center gap-4">
      <div className="relative size-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={2} stroke="var(--card)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
              {items.map((it, i) => <Cell key={it.label} fill={colorOf(it, i)} />)}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const p = active ? payload?.[0] : undefined;
                if (!p) return null;
                const v = Number(p.value ?? 0);
                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="font-medium text-foreground">{String(p.name)}</p>
                    <p className="text-muted-foreground"><span className="tabular text-foreground">{formatMoney(v, currency)}</span> · {pct(v)} %</p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="whitespace-nowrap text-xs font-semibold tabular leading-tight">{formatMoney(total, currency)}</p>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 divide-y text-sm" aria-label="Détail par catégorie">
        {items.map((it, i) => {
          const row = (
            <>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colorOf(it, i) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              <span className="tabular text-muted-foreground">{formatMoney(it.value, currency)}</span>
              <span className="w-10 text-right tabular text-xs font-medium">{pct(it.value)} %</span>
            </>
          );
          return (
            <li key={it.label}>
              {it.href ? <Link href={it.href} className="flex items-center gap-2.5 rounded px-1 py-2 hover:bg-muted/50">{row}</Link> : <div className="flex items-center gap-2.5 px-1 py-2">{row}</div>}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
