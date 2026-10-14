/** Liste de barres horizontales (répartitions : départements, tranches d'âge, motifs…). Lisible sans graphique : chaque ligne porte sa valeur en texte. */
export function BarList({ rows, format = (n) => String(n), color = "var(--viz-1)" }: { rows: { label: string; value: number; hint?: string }[]; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Aucune donnée.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-medium tabular">{format(r.value)}{r.hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.hint}</span>}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}
