"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runAction } from "@/components/app/form-kit";
import { moveTaskAction } from "../actions";
import { TASK_STATUSES } from "../schemas";

export function MyTaskStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select value={status} disabled={pending} onValueChange={(v) => start(async () => { const r = await runAction(moveTaskAction({ id, status: v as "TODO" }), { success: "Tâche mise à jour" }); if (r.ok) router.refresh(); })}>
      <SelectTrigger className="w-36" aria-label="Changer le statut de la tâche"><SelectValue /></SelectTrigger>
      <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
