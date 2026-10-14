"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}`;

export interface Series { key: string; label: string; color?: string }
type Format = "number" | "money" | "percent" | "days";

const COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];

function fmt(v: number, f: Format, currency?: string): string {
  if (f === "money") return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency ?? "XOF", maximumFractionDigits: 0 }).format(v);
  if (f === "percent") return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v)} %`;
  if (f === "days") return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v)} j`;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);
}
const compact = (v: number, f: Format) => (f === "money" ? (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v)) : String(v));

/**
 * Barres mensuelles à une ou plusieurs séries (effectifs, absences, congés, masse salariale…), avec vue tableau accessible.
 * `data` : une ligne par mois (`month` = AAAA-MM) ; chaque série lit sa clé dans la ligne.
 */
export function SeriesChart({ data, series, format = "number", currency, ariaLabel }: {
  data: ({ month: string } & Record<string, number | string>)[]; series: Series[]; format?: Format; currency?: string; ariaLabel: string;
}) {
  const [table, setTable] = useState(false);
  const rows: Record<string, number | string>[] = data.map((r) => ({ ...r, name: monthLabel(r.month) }));
  return (
    <figure aria-label={ariaLabel}>
      <div className="mb-2 flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Voir le graphique" : "Voir le tableau"}</Button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Mois</th>{series.map((s) => <th key={s.key} className="py-1 text-right font-medium">{s.label}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.month} className="border-t"><td className="py-1.5">{r.name}</td>{series.map((s) => <td key={s.key} className="py-1.5 text-right tabular">{fmt(Number(r[s.key] ?? 0), format, currency)}</td>)}</tr>)}</tbody>
        </table>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
              <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => compact(v, format)} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload, label }) => active && payload?.length ? (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium text-foreground">{label}</p>
                    {payload.map((p) => <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />{p.name} : <span className="font-medium text-foreground">{fmt(Number(p.value), format, currency)}</span></p>)}
                  </div>
                ) : null}
              />
              {series.length > 1 && <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />}
              {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
