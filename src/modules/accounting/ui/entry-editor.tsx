"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { d } from "@/core/money";
import { formatMoney } from "@/lib/reference-data";
import { createEntryAction, updateEntryAction } from "../actions";

interface LineState { key: number; ledgerAccountId: string; label: string; debit: string; credit: string }
export interface EntryInitial { journalId: string; date: string; reference: string; description: string; lines: { ledgerAccountId: string; label: string; debit: number; credit: number }[] }

/** Saisie d'une écriture d'opérations diverses : totaux en direct, équilibre contrôlé avant validation. */
export function EntryEditor({ id, initial, journals, accounts, currency }: {
  id?: string; initial: EntryInitial; journals: { id: string; code: string; name: string }[]; accounts: { id: string; code: string; name: string }[]; currency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ journalId: initial.journalId, date: initial.date, reference: initial.reference, description: initial.description });
  const blank = (key: number): LineState => ({ key, ledgerAccountId: "", label: "", debit: "", credit: "" });
  const [lines, setLines] = useState<LineState[]>(() => (initial.lines.length ? initial.lines.map((l, i) => ({ key: i, ledgerAccountId: l.ledgerAccountId, label: l.label, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "" })) : [blank(0), blank(1)]));
  const [nextKey, setNextKey] = useState(Math.max(2, initial.lines.length));
  const patch = (key: number, p: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const totalDebit = lines.reduce((a, l) => a.plus(Number(l.debit) || 0), d(0));
  const totalCredit = lines.reduce((a, l) => a.plus(Number(l.credit) || 0), d(0));
  const balanced = totalDebit.gt(0) && totalDebit.eq(totalCredit);
  const valid = f.journalId && f.description.trim().length >= 2 && lines.every((l) => l.ledgerAccountId && l.label.trim() && (Number(l.debit) > 0) !== (Number(l.credit) > 0));

  const submit = () => start(async () => {
    setError(null);
    const payload = { ...f, lines: lines.map((l) => ({ ledgerAccountId: l.ledgerAccountId, label: l.label, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })) };
    const res = id ? await updateEntryAction({ ...payload, id }) : await createEntryAction(payload);
    if (!res.ok) {
      const fe = res.error.fieldErrors ? Object.entries(res.error.fieldErrors).map(([k, v]) => `${k.replace(/^lines\.(\d+)\./, "Ligne $1 : ")} ${v[0]}`)[0] : null;
      return setError(fe ?? res.error.message);
    }
    toast.success(id ? "Brouillon enregistré" : "Brouillon créé");
    router.push(`/app/accounting/ecritures/${id ?? (res.data as { id: string }).id}`);
    router.refresh();
  });

  return (
    <div className="space-y-6">
      <FormAlert message={error} />
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Journal">
            <Select value={f.journalId} onValueChange={(v) => setF({ ...f, journalId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{journals.map((j) => <SelectItem key={j.id} value={j.id}>{j.code} — {j.name}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Date" htmlFor="en-date"><Input id="en-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Pièce justificative" htmlFor="en-ref"><Input id="en-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Libellé *" htmlFor="en-desc" className="sm:col-span-2 lg:col-span-4"><Input id="en-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <section aria-label="Lignes de l'écriture" className="space-y-3">
        <div className="hidden grid-cols-[minmax(14rem,2fr)_minmax(10rem,1.5fr)_8rem_8rem_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid"><span>Compte</span><span>Libellé</span><span>Débit</span><span>Crédit</span><span /></div>
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-2 rounded-lg border bg-card p-3 lg:grid-cols-[minmax(14rem,2fr)_minmax(10rem,1.5fr)_8rem_8rem_2rem] lg:items-start lg:border-0 lg:bg-transparent lg:p-0">
            <Select value={l.ledgerAccountId || undefined} onValueChange={(v) => patch(l.key, { ledgerAccountId: v })}>
              <SelectTrigger className="w-full" aria-label={`Compte ligne ${i + 1}`}><SelectValue placeholder="Compte…" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input value={l.label} placeholder="Libellé" aria-label={`Libellé ligne ${i + 1}`} onChange={(e) => patch(l.key, { label: e.target.value })} />
            <Input type="number" min={0} step="any" value={l.debit} placeholder="0" aria-label={`Débit ligne ${i + 1}`} onChange={(e) => patch(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            <Input type="number" min={0} step="any" value={l.credit} placeholder="0" aria-label={`Crédit ligne ${i + 1}`} onChange={(e) => patch(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Supprimer la ligne ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-muted-foreground" /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => { setLines((ls) => [...ls, blank(nextKey)]); setNextKey((k) => k + 1); }}><Plus className="size-4" /> Ajouter une ligne</Button>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" aria-live="polite">
          Débit <span className="font-semibold tabular">{formatMoney(totalDebit.toNumber(), currency)}</span> · Crédit <span className="font-semibold tabular">{formatMoney(totalCredit.toNumber(), currency)}</span>{" "}
          <span className={balanced ? "text-success" : "text-warning"}>{balanced ? "· équilibrée" : `· écart ${formatMoney(totalDebit.minus(totalCredit).abs().toNumber(), currency)}`}</span>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push(id ? `/app/accounting/ecritures/${id}` : "/app/accounting/ecritures")} disabled={pending}>Annuler</Button>
          <Button onClick={submit} disabled={pending || !valid}>{id ? "Enregistrer le brouillon" : "Créer le brouillon"}</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Le brouillon n'a pas de numéro ; il est numéroté à sa validation, après laquelle il devient immuable (correction par contre-passation).</p>
    </div>
  );
}
