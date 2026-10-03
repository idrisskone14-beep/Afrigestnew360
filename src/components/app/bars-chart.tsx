"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/reference-data";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v));

/** Une série mensuelle en barres (couleur de série n°1), infobulle et vue tableau accessibles. */
export function BarsChart({ data, currency, seriesLabel }: { data: { month: string; value: number }[]; currency: string; seriesLabel: string }) {
  const [table, setTable] = useState(false);
  const rows = data.map((d) => ({ ...d, name: label(d.month) }));
  return (
    <figure aria-label={seriesLabel}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2.5 rounded-sm" style={{ background: "var(--viz-1)" }} aria-hidden />{seriesLabel}</span>
        <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Voir le graphique" : "Voir le tableau"}</Button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Mois</th><th className="py-1 text-right font-medium">{seriesLabel}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.month} className="border-t"><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular">{formatMoney(r.value, currency)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={compact} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload, label: l }) => active && payload?.length ? (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium text-foreground">{l}</p>
                    <p className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: "var(--viz-1)" }} aria-hidden />{seriesLabel} : <span className="tabular text-foreground">{formatMoney(Number(payload[0]!.value), currency)}</span></p>
                  </div>
                ) : null}
              />
              <Bar dataKey="value" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
