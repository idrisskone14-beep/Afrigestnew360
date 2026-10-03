"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banknote, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { createRunAction, payRunAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function NewRunDialog({ defaultYear, defaultMonth }: { defaultYear: number; defaultMonth: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ year: String(defaultYear), month: String(defaultMonth) });
  const submit = () => start(async () => {
    setError(null);
    const res = await createRunAction({ year: Number(f.year), month: Number(f.month) });
    if (!res.ok) return setError(errText(res.error));
    toast.success(res.data.skipped.length ? `Campagne préparée (${res.data.skipped.length} salarié(s) sans salaire ignoré(s))` : "Campagne préparée");
    setOpen(false);
    router.push(`/app/payroll/campagnes/${res.data.id}`);
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> Nouvelle campagne</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle campagne de paie</DialogTitle><DialogDescription>Tous les bulletins du mois sont calculés à partir des salaires de base et des rubriques en vigueur à la fin du mois. Vous pourrez recalculer tant que la campagne est en brouillon.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Mois"><Select value={f.month} onValueChange={(v) => setF({ ...f, month: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Année" htmlFor="rn-year"><Input id="rn-year" type="number" min={2000} max={2100} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending} onClick={submit}>Préparer la paie</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PayRunDialog({ runId, net, currency, accounts, financeOn }: { runId: string; net: number; currency: string; accounts: { id: string; name: string; balance: number; type: string }[]; financeOn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ accountId: (accounts.find((a) => a.type === "BANK") ?? accounts[0])?.id ?? "", date: todayInput() });
  const submit = () => start(async () => {
    setError(null);
    const res = await payRunAction({ id: runId, accountId: f.accountId, date: f.date });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Salaires payés"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button><Banknote className="size-4" /> Payer les salaires</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Payer les salaires</DialogTitle><DialogDescription>Net total à payer : {formatMoney(net, currency)}. {financeOn ? "Une sortie de trésorerie est enregistrée sur le compte choisi (solde contrôlé) et l'écriture de paiement est générée." : "Le module Finance n'est pas actif : la campagne est seulement marquée payée."}</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          {financeOn && <Field label="Compte débité"><Select value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Choisir un compte…" /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} — {formatMoney(a.balance, currency)}</SelectItem>)}</SelectContent></Select></Field>}
          <Field label="Date de paiement" htmlFor="pr-date"><Input id="pr-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Button disabled={pending || (financeOn && !f.accountId)} onClick={submit}>Confirmer le paiement</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
