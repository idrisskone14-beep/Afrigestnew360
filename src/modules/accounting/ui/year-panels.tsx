"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, LockOpen, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, runAction } from "@/components/app/form-kit";
import { cn } from "@/lib/utils";
import { createFiscalYearAction, generateMissingEntriesAction, lockPeriodAction } from "../actions";

const MONTHS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

export function PeriodToggles({ periods, closed, canManage }: { periods: { id: string; month: number; status: "OPEN" | "LOCKED" }[]; closed: boolean; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = (id: string, locked: boolean) => start(async () => { const r = await runAction(lockPeriodAction({ id, locked }), { success: locked ? "Période verrouillée" : "Période rouverte" }); if (r.ok) router.refresh(); });
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {periods.map((p) => (
        <li key={p.id}>
          <Button variant="outline" size="sm" className={cn("w-full justify-between", p.status === "LOCKED" && "bg-muted text-muted-foreground")} disabled={pending || closed || !canManage} aria-pressed={p.status === "LOCKED"} aria-label={`${MONTHS[p.month]} : ${p.status === "LOCKED" ? "verrouillée, cliquer pour rouvrir" : "ouverte, cliquer pour verrouiller"}`} onClick={() => toggle(p.id, p.status !== "LOCKED")}>
            {MONTHS[p.month]}{p.status === "LOCKED" ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5 text-success" />}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function NewYearDialog({ suggestedStart }: { suggestedStart: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const y = Number(suggestedStart.slice(0, 4));
  const [f, setF] = useState({ name: String(y), startDate: suggestedStart, endDate: `${y}-12-31` });
  const submit = () => start(async () => {
    setError(null);
    const res = await createFiscalYearAction(f);
    if (!res.ok) return setError(res.error.message);
    toast.success("Exercice créé"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="outline"><Plus className="size-4" /> Nouvel exercice</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvel exercice comptable</DialogTitle><DialogDescription>Douze mois en général (jusqu'à 18 mois pour un premier exercice). Les périodes mensuelles sont créées automatiquement.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Nom" htmlFor="fy-name" className="sm:col-span-2"><Input id="fy-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Début" htmlFor="fy-start"><Input id="fy-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Fin" htmlFor="fy-end"><Input id="fy-end" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || f.name.trim().length < 2} onClick={submit}>Créer l'exercice</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BackfillButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await runAction(generateMissingEntriesAction({}));
      if (!r.ok) return;
      if (r.data.errors.length) toast.warning(`${r.data.created} document(s) comptabilisé(s), ${r.data.errors.length} refusé(s) : ${r.data.errors[0]}`);
      else toast.success(r.data.created ? `${r.data.created} document(s) comptabilisé(s)` : "Tous les documents sont déjà comptabilisés");
      router.refresh();
    })}>
      <RefreshCw className="size-4" /> Générer les écritures manquantes
    </Button>
  );
}
