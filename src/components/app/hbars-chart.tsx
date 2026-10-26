import Link from "next/link";
import { formatMoney } from "@/lib/reference-data";

export interface HBarItem { label: string; value: number; sub?: string; group?: 0 | 1; href?: string }

const COLOR = ["var(--viz-1)", "var(--viz-2)"] as const;

/**
 * Classement en barres de progression : sur chaque ligne, l'étiquette et la valeur écrite en toutes lettres, puis une barre fine
 * (8 px, bout arrondi) sur toute la largeur. Cette disposition tient dans les cartes les plus étroites. Une légende n'apparaît que
 * si deux familles de barres sont distinguées (`groups`). Rendu serveur, sans JavaScript : les valeurs sont toujours écrites.
 */
export function HBarsChart({ items, groups, currency, label }: { items: HBarItem[]; groups?: [string, string]; currency: string; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <figure aria-label={label}>
      {groups && (
        <ul className="mb-3 flex items-center gap-4 text-xs text-muted-foreground" aria-label="Légende">
          {groups.map((g, k) => <li key={g} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: COLOR[k] }} aria-hidden />{g}</li>)}
        </ul>
      )}
      <ul className="space-y-0.5">
        {items.map((it) => {
          const width = it.value > 0 ? Math.max(2, (it.value / max) * 100) : 0;
          const body = (
            <div className="px-2 py-2" title={`${it.label} : ${formatMoney(it.value, currency)}`}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p className="min-w-0 truncate text-sm">{it.label}</p>
                  {it.sub && <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{it.sub}</span>}
                </div>
                <span className={`shrink-0 text-sm tabular ${it.value > 0 ? "font-medium" : "text-muted-foreground"}`}>{formatMoney(it.value, currency)}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-muted" aria-hidden>
                <div className="h-2 rounded-full" style={{ width: `${width}%`, background: COLOR[it.group ?? 0] }} />
              </div>
            </div>
          );
          return <li key={it.label}>{it.href ? <Link href={it.href} className="block rounded-md hover:bg-muted/50">{body}</Link> : body}</li>;
        })}
      </ul>
    </figure>
  );
}
