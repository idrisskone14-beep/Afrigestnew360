"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/reference-data";

export interface CashflowDatum { month: string; inflow: number; outflow: number }

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v));

/** Encaissements vs décaissements par mois : barres groupées (bleu / orange), légende, infobulle et vue tableau. */
export function CashflowChart({ data, currency, title = "Encaissements et décaissements" }: { data: CashflowDatum[]; currency: string; title?: string }) {
  const [table, setTable] = useState(false);
  const rows = data.map((d) => ({ ...d, name: label(d.month) }));
  return (
    <figure aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Légende">
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--viz-1)" }} aria-hidden />Encaissements</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--viz-2)" }} aria-hidden />Décaissements</li>
        </ul>
        <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Voir le graphique" : "Voir le tableau"}</Button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Mois</th><th className="py-1 text-right font-medium">Encaissements</th><th className="py-1 text-right font-medium">Décaissements</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.month} className="border-t"><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular">{formatMoney(r.inflow, currency)}</td><td className="py-1.5 text-right tabular">{formatMoney(r.outflow, currency)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} tickFormatter={compact} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload, label: l }) => active && payload?.length ? (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium text-foreground">{l}</p>
                    {payload.map((p) => <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />{p.dataKey === "inflow" ? "Encaissements" : "Décaissements"} : <span className="tabular text-foreground">{formatMoney(Number(p.value), currency)}</span></p>)}
                  </div>
                ) : null}
              />
              <Bar dataKey="inflow" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="outflow" fill="var(--viz-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
