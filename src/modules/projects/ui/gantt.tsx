import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface GanttTask { id: string; title: string; status: string; assignee: string | null; start: Date; end: Date; dependsOn: string | null }

const DAY = 86_400_000;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const COLOR: Record<string, string> = { TODO: "var(--muted-foreground)", IN_PROGRESS: "var(--viz-1)", REVIEW: "var(--viz-2)", DONE: "var(--success)" };

/** Diagramme de Gantt simple (rendu serveur, sans dépendance) : une ligne par tâche datée, repères mensuels et aujourd'hui. */
export function Gantt({ tasks, today }: { tasks: GanttTask[]; today: Date }) {
  if (tasks.length === 0) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune tâche datée : renseignez un début et/ou une échéance pour les voir ici.</p>;
  const min = Math.min(...tasks.map((t) => t.start.getTime()), today.getTime());
  const max = Math.max(...tasks.map((t) => t.end.getTime()), today.getTime());
  const from = new Date(Date.UTC(new Date(min).getUTCFullYear(), new Date(min).getUTCMonth(), 1));
  const to = new Date(Date.UTC(new Date(max).getUTCFullYear(), new Date(max).getUTCMonth() + 1, 1));
  const span = to.getTime() - from.getTime();
  const pct = (t: number) => `${(((t - from.getTime()) / span) * 100).toFixed(3)}%`;
  const months: { label: string; left: string; width: string }[] = [];
  for (let cur = new Date(from); cur < to; cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    months.push({ label: `${MONTHS[cur.getUTCMonth()]} ${String(cur.getUTCFullYear()).slice(2)}`, left: pct(cur.getTime()), width: `${(((next.getTime() - cur.getTime()) / span) * 100).toFixed(3)}%` });
  }
  return (
    <div className="overflow-x-auto rounded-lg border" role="img" aria-label="Diagramme de Gantt des tâches du projet">
      <div className="min-w-[640px]">
        <div className="flex border-b bg-muted/40 text-xs text-muted-foreground">
          <div className="w-56 shrink-0 px-3 py-2 font-medium">Tâche</div>
          <div className="relative h-8 flex-1">{months.map((m) => <div key={m.label} className="absolute inset-y-0 border-l px-1.5 py-2" style={{ left: m.left, width: m.width }}>{m.label}</div>)}</div>
        </div>
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center border-b last:border-0">
            <div className="w-56 shrink-0 px-3 py-2"><p className="truncate text-sm font-medium">{t.title}</p><p className="truncate text-xs text-muted-foreground">{t.assignee ?? "Non assignée"}{t.dependsOn ? ` · après « ${t.dependsOn} »` : ""}</p></div>
            <div className="relative h-9 flex-1">
              {months.map((m) => <div key={m.label} className="absolute inset-y-0 border-l" style={{ left: m.left }} />)}
              <div className={cn("absolute top-2 h-5 rounded", t.status === "DONE" && "opacity-80")} title={`${t.title} : ${fmtDate(t.start)} → ${fmtDate(t.end)}`}
                style={{ left: pct(t.start.getTime()), width: `max(0.8%, ${(((t.end.getTime() + DAY - t.start.getTime()) / span) * 100).toFixed(3)}%)`, background: COLOR[t.status] }} />
              <div className="absolute inset-y-0 w-px bg-destructive/70" style={{ left: pct(today.getTime()) }} aria-hidden />
            </div>
          </div>
        ))}
      </div>
      <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">Trait rouge : aujourd'hui · couleurs : à faire (gris), en cours (bleu), en revue (orange), terminé (vert).</p>
    </div>
  );
}
