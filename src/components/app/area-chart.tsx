"use client";

import { useId, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/reference-data";
import { compact, monthLabel, variation } from "./chart-utils";

export interface AreaDatum { month: string; value: number; previous: number }

/**
 * Courbe mensuelle de l'année en cours (aire, trait de 2 px) comparée à l'année précédente (pointillés neutres).
 * Chiffre clé et variation en tête ; infobulle au survol (repère vertical) ; vue tableau pour les lecteurs d'écran et l'impression.
 */
export function AreaTrendChart({ data, currency, seriesLabel, previousLabel }: { data: AreaDatum[]; currency: string; seriesLabel: string; previousLabel: string }) {
  const [table, setTable] = useState(false);
  const gradient = useId().replace(/:/g, "");
  const rows = data.map((d) => ({ ...d, name: monthLabel(d.month) }));
  const total = data.reduce((a, d) => a + d.value, 0);
  const prevTotal = data.reduce((a, d) => a + d.previous, 0);
  const delta = variation(total, prevTotal);
  const empty = total === 0 && prevTotal === 0;
  return (
    <figure aria-label={`${seriesLabel} et ${previousLabel.toLowerCase()}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Total sur 12 mois</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-2xl font-semibold tracking-tight tabular">{formatMoney(total, currency)}</span>
            {delta !== null && (
              <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${delta >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {delta >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                {delta >= 0 ? "+" : ""}{delta} %<span className="sr-only"> par rapport à l&apos;année précédente</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Légende">
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: "var(--viz-1)" }} aria-hidden />{seriesLabel}</li>
            <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: "var(--viz-other)" }} aria-hidden />{previousLabel}</li>
          </ul>
          <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Voir le graphique" : "Voir le tableau"}</Button>
        </div>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Mois</th><th className="py-1 text-right font-medium">{seriesLabel}</th><th className="py-1 text-right font-medium">{previousLabel}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.month} className="border-t"><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular">{formatMoney(r.value, currency)}</td><td className="py-1.5 text-right tabular text-muted-foreground">{formatMoney(r.previous, currency)}</td></tr>)}</tbody>
        </table>
      ) : empty ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Aucune facture sur les 24 derniers mois.</p>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={compact} />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4, strokeDasharray: "3 3" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const cur = Number(payload.find((p) => p.dataKey === "value")?.value ?? 0);
                  const prev = Number(payload.find((p) => p.dataKey === "previous")?.value ?? 0);
                  const v = variation(cur, prev);
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium text-foreground">{label}</p>
                      <p className="flex items-center gap-2 text-muted-foreground"><span className="h-0.5 w-3 rounded" style={{ background: "var(--viz-1)" }} aria-hidden />{seriesLabel} : <span className="font-medium text-foreground tabular">{formatMoney(cur, currency)}</span></p>
                      <p className="flex items-center gap-2 text-muted-foreground"><span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: "var(--viz-other)" }} aria-hidden />{previousLabel} : <span className="tabular">{formatMoney(prev, currency)}</span></p>
                      {v !== null && <p className="mt-1 text-muted-foreground">Écart : <span className="font-medium text-foreground">{v >= 0 ? "+" : ""}{v} %</span></p>}
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="previous" stroke="var(--viz-other)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="value" stroke="var(--viz-1)" strokeWidth={2} fill={`url(#${gradient})`} dot={false} activeDot={{ r: 5, fill: "var(--viz-1)", stroke: "var(--card)", strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
