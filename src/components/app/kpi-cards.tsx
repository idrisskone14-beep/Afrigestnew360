import { cn } from "@/lib/utils";

export interface Kpi {
  label: string;
  /** Nombre de documents (affiché en haut à droite). */
  count?: number;
  /** Montant déjà formaté. */
  amount: string;
  /** Précision sous le montant (« TTC »…). */
  tag?: string;
  tone?: "blue" | "green" | "red" | "amber";
}

const TONE = { blue: "border-l-brand-blue", green: "border-l-success", red: "border-l-destructive", amber: "border-l-brand-2" } as const;

/** Cartes de chiffres en tête de liste : liseré coloré à gauche, nombre de documents, montant. */
export function KpiCards({ items }: { items: Kpi[] }) {
  return (
    <section aria-label="Chiffres clés" className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className={cn("rounded-lg border border-l-4 bg-card px-4 py-3", TONE[k.tone ?? "blue"])}>
          <div className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
            <span className="truncate">{k.label}</span>
            {k.count !== undefined && <span className="font-semibold text-foreground tabular">{k.count}</span>}
          </div>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-base font-semibold tabular sm:text-xl">
            {k.amount}
            {k.tag && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{k.tag}</span>}
          </p>
        </div>
      ))}
    </section>
  );
}
