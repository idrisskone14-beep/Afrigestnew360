"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { runAction } from "@/components/app/form-kit";
import { cn } from "@/lib/utils";
import { completeActivityAction, deleteActivityAction } from "../actions";

export function ActivityRow({ id, subject, typeLabel, done, overdue, dueLabel, canEdit, context }: {
  id: string; subject: string; typeLabel: string; done: boolean; overdue: boolean; dueLabel: string | null; canEdit: boolean; context: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Checkbox checked={done} disabled={!canEdit || pending} aria-label={done ? "Marquer comme à faire" : "Marquer comme fait"}
        onCheckedChange={(v) => start(async () => { const r = await runAction(completeActivityAction({ id, done: v === true })); if (r.ok) router.refresh(); })} />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", done && "text-muted-foreground line-through")}>{subject}</p>
        <p className="text-xs text-muted-foreground">{typeLabel}{context ? <> · {context}</> : null}</p>
      </div>
      {dueLabel && <span className={cn("hidden text-xs sm:block", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>{overdue ? "En retard · " : ""}{dueLabel}</span>}
      {canEdit && <Button variant="ghost" size="icon" aria-label="Supprimer" disabled={pending} onClick={() => start(async () => { const r = await runAction(deleteActivityAction({ id }), { success: "Activité supprimée" }); if (r.ok) router.refresh(); })}><Trash2 className="size-4 text-muted-foreground" /></Button>}
    </li>
  );
}
