"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionButton } from "@/components/app/action-button";
import { Field, FormAlert } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { createEvaluationAction, createTrainingAction, deleteEvaluationAction, deleteTrainingAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

export function EvaluationDialog({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { period: `${new Date().getFullYear()}`, date: todayInput(), score: "3", objectives: "", comments: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const res = await createEvaluationAction({ employeeId, period: f.period, date: f.date, score: Number(f.score), objectives: f.objectives, comments: f.comments });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Évaluation enregistrée"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Évaluation</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle évaluation</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3"><FormAlert message={error} /></div>
          <Field label="Période" htmlFor="ev-period"><Input id="ev-period" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} placeholder="2026-S1" /></Field>
          <Field label="Date" htmlFor="ev-date"><Input id="ev-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Note (1 à 5)" htmlFor="ev-score"><Input id="ev-score" type="number" min={1} max={5} value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} /></Field>
          <Field label="Objectifs" htmlFor="ev-obj" className="sm:col-span-3"><Textarea id="ev-obj" rows={2} value={f.objectives} onChange={(e) => setF({ ...f, objectives: e.target.value })} /></Field>
          <Field label="Commentaires" htmlFor="ev-com" className="sm:col-span-3"><Textarea id="ev-com" rows={2} value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} /></Field>
          <Button className="sm:col-span-3" disabled={pending || f.period.trim().length < 2} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TrainingDialog({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { title: "", provider: "", date: todayInput(), hours: "0", cost: "0", notes: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const res = await createTrainingAction({ employeeId, title: f.title, provider: f.provider, date: f.date, hours: Number(f.hours || 0), cost: Number(f.cost || 0), notes: f.notes });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Formation enregistrée"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Formation</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle formation</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Intitulé *" htmlFor="tr-title" className="sm:col-span-2"><Input id="tr-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Organisme" htmlFor="tr-prov"><Input id="tr-prov" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
          <Field label="Date" htmlFor="tr-date"><Input id="tr-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Durée (heures)" htmlFor="tr-hours"><Input id="tr-hours" type="number" min={0} step="any" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
          <Field label="Coût" htmlFor="tr-cost"><Input id="tr-cost" type="number" min={0} step="any" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || f.title.trim().length < 2} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const DeleteEvaluationButton = ({ id }: { id: string }) => <ActionButton action={deleteEvaluationAction} input={{ id }} variant="ghost" size="sm" label="Supprimer" icon={<Trash2 className="size-4" />} success="Évaluation supprimée" confirm={{ title: "Supprimer cette évaluation ?" }} />;
export const DeleteTrainingButton = ({ id }: { id: string }) => <ActionButton action={deleteTrainingAction} input={{ id }} variant="ghost" size="sm" label="Supprimer" icon={<Trash2 className="size-4" />} success="Formation supprimée" confirm={{ title: "Supprimer cette formation ?" }} />;
