"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarPlus, Pencil, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { createLeaveTypeAction, requestLeaveAction, updateLeaveTypeAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

/** Jours ouvrés (lun-ven) — même règle que le serveur, pour l'aperçu uniquement (le serveur recalcule). */
function previewDays(start: string, end: string) {
  if (!start || !end || end < start) return 0;
  let n = 0;
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86_400_000) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export function LeaveRequestDialog({ employees, types, defaultEmployeeId }: { employees: { id: string; name: string }[]; types: { id: string; name: string }[]; defaultEmployeeId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { employeeId: defaultEmployeeId ?? employees[0]?.id ?? "", typeId: types[0]?.id ?? "", startDate: todayInput(), endDate: todayInput(), reason: "" };
  const [f, setF] = useState(init);
  const days = previewDays(f.startDate, f.endDate);
  const submit = () => start(async () => {
    setError(null);
    const res = await requestLeaveAction(f);
    if (!res.ok) return setError(errText(res.error));
    toast.success(res.data.autoApproved ? "Congé enregistré (accepté d'office : aucun autre approbateur)" : "Demande envoyée pour validation");
    setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button><CalendarPlus className="size-4" /> Demander un congé</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Demande de congé</DialogTitle><DialogDescription>Les jours ouvrés (lundi-vendredi) sont comptés automatiquement ; la demande est validée par un approbateur.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          {employees.length > 1 && (
            <Field label="Salarié" className="sm:col-span-2"><Select value={f.employeeId} onValueChange={(v) => setF({ ...f, employeeId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select></Field>
          )}
          <Field label="Type de congé" className="sm:col-span-2"><Select value={f.typeId} onValueChange={(v) => setF({ ...f, typeId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Du" htmlFor="lv-start"><Input id="lv-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} /></Field>
          <Field label="Au (inclus)" htmlFor="lv-end"><Input id="lv-end" type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <p className="text-sm text-muted-foreground sm:col-span-2" aria-live="polite">{days > 0 ? `${days} jour${days > 1 ? "s" : ""} ouvré${days > 1 ? "s" : ""}` : "Aucun jour ouvré sur cette période"}</p>
          <Field label="Motif" htmlFor="lv-reason" className="sm:col-span-2"><Textarea id="lv-reason" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || days === 0 || !f.employeeId || !f.typeId} onClick={submit}>Envoyer la demande</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface LeaveTypeRow { id: string; name: string; annualDays: number; paid: boolean; isActive: boolean }

export function LeaveTypesDialog({ types }: { types: LeaveTypeRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState({ name: "", annualDays: "0", paid: true });
  const [edit, setEdit] = useState<Record<string, { annualDays: string; paid: boolean; isActive: boolean }>>(() => Object.fromEntries(types.map((t) => [t.id, { annualDays: String(t.annualDays), paid: t.paid, isActive: t.isActive }])));
  const save = (t: LeaveTypeRow) => start(async () => {
    setError(null);
    const v = edit[t.id]!;
    const res = await updateLeaveTypeAction({ id: t.id, name: t.name, annualDays: Number(v.annualDays || 0), paid: v.paid, isActive: v.isActive });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Type de congé mis à jour"); router.refresh();
  });
  const add = () => start(async () => {
    setError(null);
    const res = await createLeaveTypeAction({ name: n.name, annualDays: Number(n.annualDays || 0), paid: n.paid });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Type ajouté"); setN({ name: "", annualDays: "0", paid: true }); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="outline"><Settings2 className="size-4" /> Types de congé</Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Types de congé</DialogTitle><DialogDescription>Droit annuel en jours ouvrés (0 = non plafonné). Valeurs de départ indicatives : adaptez-les au droit du travail et à votre convention.</DialogDescription></DialogHeader>
        <FormAlert message={error} />
        <ul className="divide-y rounded-lg border">
          {types.map((t) => {
            const v = edit[t.id]!;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-medium">{t.name}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Jours/an<Input type="number" min={0} className="h-8 w-20" value={v.annualDays} onChange={(e) => setEdit({ ...edit, [t.id]: { ...v, annualDays: e.target.value } })} /></label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={v.paid} onCheckedChange={(c) => setEdit({ ...edit, [t.id]: { ...v, paid: c } })} aria-label={`${t.name} payé`} />Payé</label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={v.isActive} onCheckedChange={(c) => setEdit({ ...edit, [t.id]: { ...v, isActive: c } })} aria-label={`${t.name} actif`} />Actif</label>
                <Button size="icon" variant="ghost" disabled={pending} aria-label={`Enregistrer ${t.name}`} onClick={() => save(t)}><Pencil className="size-4" /></Button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <Field label="Nouveau type" htmlFor="lt-name" className="min-w-40 flex-1"><Input id="lt-name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <Field label="Jours/an" htmlFor="lt-days"><Input id="lt-days" type="number" min={0} className="w-24" value={n.annualDays} onChange={(e) => setN({ ...n, annualDays: e.target.value })} /></Field>
          <label className="flex items-center gap-1.5 pb-2 text-sm"><Switch checked={n.paid} onCheckedChange={(c) => setN({ ...n, paid: c })} aria-label="Payé" />Payé</label>
          <Button disabled={pending || n.name.trim().length < 2} onClick={add}><Plus className="size-4" /> Ajouter</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
