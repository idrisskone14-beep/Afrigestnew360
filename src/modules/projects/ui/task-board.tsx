"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { runAction } from "@/components/app/form-kit";
import { cn } from "@/lib/utils";
import { deleteTaskAction, moveTaskAction } from "../actions";
import { PRIORITIES, TASK_STATUSES } from "../schemas";
import { TaskDialog, type TaskInit } from "./project-dialogs";

export interface BoardTask { id: string; title: string; status: string; priority: string; assignee: string | null; dueDate: string | null; overdue: boolean; estimateHours: number; dependsOn: string | null; init: TaskInit; canMove: boolean }
const PRIORITY_TONE: Record<string, string> = { LOW: "text-muted-foreground", MEDIUM: "", HIGH: "text-warning", URGENT: "font-semibold text-destructive" };

/** Tableau Kanban : glisser-déposer ou boutons (accessibles au clavier) pour changer de colonne. */
export function TaskBoard({ tasks, projectId, employees, canEdit, readOnly }: { tasks: BoardTask[]; projectId: string; employees: { id: string; name: string }[]; canEdit: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = (id: string, status: string) => start(async () => { const r = await runAction(moveTaskAction({ id, status: status as "TODO" })); if (r.ok) router.refresh(); });
  const options = tasks.map((t) => ({ id: t.id, name: t.title }));

  return (
    <div className="grid gap-4 lg:grid-cols-4" aria-busy={pending}>
      {TASK_STATUSES.map((col, ci) => {
        const items = tasks.filter((t) => t.status === col.value);
        return (
          <section key={col.value} aria-label={col.label} onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.value); } }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = dragging; setDragging(null); if (id && tasks.find((t) => t.id === id)?.status !== col.value) move(id, col.value); }}
            className={cn("rounded-lg border bg-muted/30 p-3 transition-colors", over === col.value && "border-brand bg-brand/5")}>
            <h3 className="mb-3 flex items-center justify-between text-sm font-semibold">{col.label}<span className="text-xs font-normal text-muted-foreground">{items.length}</span></h3>
            <ul className="space-y-2">
              {items.map((t) => (
                <li key={t.id} draggable={!readOnly && t.canMove} onDragStart={() => setDragging(t.id)} onDragEnd={() => { setDragging(null); setOver(null); }}
                  className={cn("rounded-md border bg-card p-3 shadow-sm", !readOnly && t.canMove && "cursor-grab active:cursor-grabbing", dragging === t.id && "opacity-50")}>
                  <p className="text-sm font-medium">{t.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className={PRIORITY_TONE[t.priority]}>{PRIORITIES.find((p) => p.value === t.priority)?.label}</span>
                    {t.assignee && <span>{t.assignee}</span>}
                    {t.dueDate && <span className={t.overdue && t.status !== "DONE" ? "font-medium text-destructive" : ""}>échéance {t.dueDate}</span>}
                    {t.estimateHours > 0 && <span>{t.estimateHours} h</span>}
                  </div>
                  {t.dependsOn && <Badge variant="outline" className="mt-1.5 max-w-full truncate">après « {t.dependsOn} »</Badge>}
                  {!readOnly && (
                    <div className="mt-2 flex items-center gap-1">
                      {t.canMove && <Button size="icon" variant="ghost" className="size-7" aria-label={`Déplacer « ${t.title} » vers la colonne précédente`} disabled={pending || ci === 0} onClick={() => move(t.id, TASK_STATUSES[ci - 1]!.value)}><ChevronLeft className="size-4" /></Button>}
                      {t.canMove && <Button size="icon" variant="ghost" className="size-7" aria-label={`Déplacer « ${t.title} » vers la colonne suivante`} disabled={pending || ci === TASK_STATUSES.length - 1} onClick={() => move(t.id, TASK_STATUSES[ci + 1]!.value)}><ChevronRight className="size-4" /></Button>}
                      {canEdit && <TaskDialog task={t.init} projectId={projectId} employees={employees} tasks={options} trigger={<Button size="icon" variant="ghost" className="size-7" aria-label={`Modifier « ${t.title} »`}><Pencil className="size-3.5" /></Button>} />}
                      {canEdit && <ActionButton action={deleteTaskAction} input={{ id: t.id }} size="sm" variant="ghost" className="h-7 px-2 text-xs" label="Supprimer" icon={<Trash2 className="size-3.5" />} success="Tâche supprimée" confirm={{ title: "Supprimer cette tâche ?", description: "Impossible si du temps a été saisi dessus." }} />}
                    </div>
                  )}
                </li>
              ))}
              {items.length === 0 && <li className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">Aucune tâche</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
