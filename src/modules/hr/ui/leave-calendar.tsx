import { cn } from "@/lib/utils";
import type { LeaveOverview } from "../analytics";

const DOW = ["D", "L", "M", "M", "J", "V", "S"];

/**
 * Calendrier d'absences du mois : une ligne par salarié, une colonne par jour. Case pleine = congé approuvé, hachurée = en attente de validation ;
 * colonnes grisées = jour non travaillé, colonne ambrée = jour férié. La dernière ligne compte les absents de chaque jour.
 */
export function LeaveCalendar({ data, highThreshold }: { data: LeaveOverview; highThreshold: number }) {
  const total = (date: string) => data.absentPerDay[date] ?? 0;
  const colBg = (d: LeaveOverview["days"][number]) => (d.holiday ? "bg-warning/15" : d.off ? "bg-muted/70" : "");
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-max min-w-full border-collapse text-xs">
        <caption className="sr-only">Calendrier des congés du mois</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-44 bg-card px-3 py-2 text-left font-medium text-muted-foreground">Salarié</th>
            {data.days.map((d) => (
              <th key={d.date} scope="col" title={d.holiday ?? undefined} className={cn("w-8 min-w-8 border-l px-0 py-1 text-center font-medium", colBg(d), d.holiday ? "text-warning" : "text-muted-foreground")}>
                <span className="block text-[10px] leading-none opacity-70">{DOW[d.dow]}</span>{d.day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id} className="border-t">
              <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-medium"><span className="block max-w-44 truncate text-sm">{r.name}</span>{r.department && <span className="block truncate text-[11px] font-normal text-muted-foreground">{r.department}</span>}</th>
              {data.days.map((d) => {
                const c = r.cells[d.date];
                return (
                  <td key={d.date} className={cn("h-9 border-l p-0 text-center", colBg(d))}>
                    {c && (
                      <span
                        title={`${r.name} — ${c.type}${c.status === "PENDING" ? " (en attente)" : ""}`}
                        className={cn("mx-auto grid size-6 place-items-center rounded-sm text-[10px] font-semibold", c.status === "APPROVED" ? (c.paid ? "bg-brand-blue text-white" : "bg-brand-2 text-brand-2-foreground") : "border border-brand-blue bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,color-mix(in_srgb,var(--brand-blue)_35%,transparent)_3px,color-mix(in_srgb,var(--brand-blue)_35%,transparent)_6px)] text-brand-blue")}
                      >
                        <span className="sr-only">{c.status === "APPROVED" ? "Congé" : "Congé en attente"} {c.type}</span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {data.rows.length === 0 && <tr><td colSpan={data.days.length + 1} className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun salarié à afficher.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/40">
            <th scope="row" className="sticky left-0 z-10 bg-muted/40 px-3 py-1.5 text-left text-xs font-medium">Absents (approuvés)</th>
            {data.days.map((d) => {
              const n = total(d.date);
              return <td key={d.date} className={cn("border-l p-0 text-center text-[11px] tabular", n >= highThreshold && n > 0 ? "bg-destructive/10 font-bold text-destructive" : "text-muted-foreground")}>{n > 0 ? n : ""}</td>;
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
