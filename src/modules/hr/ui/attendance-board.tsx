"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runAction } from "@/components/app/form-kit";
import { markAllPresentAction, setAttendanceAction } from "../actions";
import { ATTENDANCE_STATUSES } from "../schemas";

export interface BoardItem { employeeId: string; number: string; name: string; jobTitle: string | null; status: string | null; checkIn: string; checkOut: string; onLeave: boolean }
const NONE = "__none";

/** Feuille de présence d'un jour : une ligne par salarié en activité (congé approuvé affiché, non pointable). */
export function AttendanceBoard({ date, rows, canManage, isWeekend, isFuture }: { date: string; rows: BoardItem[]; canManage: boolean; isWeekend: boolean; isFuture: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, { status: string; checkIn: string; checkOut: string }>>(() => Object.fromEntries(rows.map((r) => [r.employeeId, { status: r.status ?? "", checkIn: r.checkIn, checkOut: r.checkOut }])));
  const save = (id: string) => start(async () => {
    const v = draft[id]!;
    if (!v.status) { toast.error("Choisissez un statut."); return; }
    const r = await runAction(setAttendanceAction({ employeeId: id, date, status: v.status as "PRESENT", checkIn: v.checkIn, checkOut: v.checkOut }), { success: "Pointage enregistré" });
    if (r.ok) router.refresh();
  });
  const bulk = () => start(async () => {
    const r = await runAction(markAllPresentAction({ date }));
    if (r.ok) { toast.success(r.data.marked ? `${r.data.marked} salarié(s) marqué(s) présent(s)` : "Tout le monde est déjà pointé"); router.refresh(); }
  });
  const editable = canManage && !isFuture;

  return (
    <div className="space-y-3">
      {editable && !isWeekend && <div className="flex justify-end"><Button variant="outline" disabled={pending} onClick={bulk}><CheckCheck className="size-4" /> Marquer tous les non-pointés présents</Button></div>}
      {isWeekend && <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">Jour de week-end : aucun pointage attendu.</p>}
      {isFuture && <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">Les présences ne se saisissent pas à l'avance.</p>}
      <Card className="divide-y p-0">
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Aucun salarié en activité à cette date.</p>}
        {rows.map((r) => {
          const v = draft[r.employeeId]!;
          const dirty = v.status !== (r.status ?? "") || v.checkIn !== r.checkIn || v.checkOut !== r.checkOut;
          return (
            <div key={r.employeeId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.name}</p><p className="truncate text-xs text-muted-foreground">{r.number}{r.jobTitle ? ` · ${r.jobTitle}` : ""}</p></div>
              {r.onLeave ? <Badge variant="secondary">En congé</Badge> : (
                <>
                  <Select value={v.status || NONE} disabled={!editable} onValueChange={(s) => setDraft({ ...draft, [r.employeeId]: { ...v, status: s === NONE ? "" : s } })}>
                    <SelectTrigger className="w-40" aria-label={`Statut de ${r.name}`}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={NONE}>— Non pointé —</SelectItem>{ATTENDANCE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="time" className="h-9 w-28" disabled={!editable} aria-label={`Arrivée de ${r.name}`} value={v.checkIn} onChange={(e) => setDraft({ ...draft, [r.employeeId]: { ...v, checkIn: e.target.value } })} />
                  <Input type="time" className="h-9 w-28" disabled={!editable} aria-label={`Départ de ${r.name}`} value={v.checkOut} onChange={(e) => setDraft({ ...draft, [r.employeeId]: { ...v, checkOut: e.target.value } })} />
                  {editable && <Button size="icon" variant={dirty ? "default" : "ghost"} disabled={pending || !dirty} aria-label={`Enregistrer ${r.name}`} onClick={() => save(r.employeeId)}><Check className="size-4" /></Button>}
                </>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
