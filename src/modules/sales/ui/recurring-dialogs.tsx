"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { createRecurringFromInvoiceAction, updateRecurringAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

const FREQUENCIES = [
  { value: "MONTHLY", label: "Chaque mois" }, { value: "QUARTERLY", label: "Chaque trimestre" },
  { value: "SEMIANNUAL", label: "Chaque semestre" }, { value: "YEARLY", label: "Chaque année" },
] as const;
type Frequency = (typeof FREQUENCIES)[number]["value"];

interface Values { title: string; frequency: Frequency; nextRunDate: string; endDate: string; autoIssue: boolean; autoSend: boolean }

function Form({ initial, pending, error, submitLabel, onSubmit }: { initial: Values; pending: boolean; error: string | null; submitLabel: string; onSubmit: (v: Values) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="grid gap-4">
      <FormAlert message={error} />
      <Field label="Nom du modèle *" htmlFor="rc-title"><Input id="rc-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fréquence">
          <Select value={v.frequency} onValueChange={(f) => setV({ ...v, frequency: f as Frequency })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Prochaine facture le *" htmlFor="rc-next"><Input id="rc-next" type="date" value={v.nextRunDate} onChange={(e) => setV({ ...v, nextRunDate: e.target.value })} /></Field>
      </div>
      <Field label="Dernière facture au plus tard le" htmlFor="rc-end" hint="Vide = sans fin"><Input id="rc-end" type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>
      <div className="grid gap-2.5 rounded-lg border bg-muted/40 p-3 text-sm">
        <label className="flex items-start gap-2"><Checkbox className="mt-0.5" checked={v.autoIssue} onCheckedChange={(c) => setV({ ...v, autoIssue: c === true, autoSend: c === true ? v.autoSend : false })} /> <span><strong>Émettre automatiquement</strong><span className="block text-muted-foreground">Sinon, un brouillon est créé et vous l&apos;émettez vous-même.</span></span></label>
        <label className="flex items-start gap-2"><Checkbox className="mt-0.5" checked={v.autoSend} disabled={!v.autoIssue} onCheckedChange={(c) => setV({ ...v, autoSend: c === true })} /> <span><strong>Envoyer par e-mail au client</strong><span className="block text-muted-foreground">Avec le PDF et le lien de consultation (nécessite l&apos;émission automatique).</span></span></label>
      </div>
      <Button disabled={pending || v.title.trim().length < 2 || !v.nextRunDate} onClick={() => onSubmit(v)}>{pending ? "Enregistrement…" : submitLabel}</Button>
    </div>
  );
}

const nextMonth = () => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };

/** « Rendre récurrente » : crée un modèle à partir d'une facture (mêmes lignes, même client). */
export function MakeRecurringDialog({ invoiceId, customerName }: { invoiceId: string; customerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="outline"><Repeat className="size-4" /> Rendre récurrente</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Facture récurrente</DialogTitle><DialogDescription>Une facture identique est générée à chaque échéance pour {customerName} (abonnement, loyer, maintenance…).</DialogDescription></DialogHeader>
        <Form
          initial={{ title: `Facture récurrente — ${customerName}`, frequency: "MONTHLY", nextRunDate: nextMonth(), endDate: "", autoIssue: false, autoSend: false }}
          pending={pending} error={error} submitLabel="Créer le modèle"
          onSubmit={(v) => start(async () => {
            setError(null);
            const res = await createRecurringFromInvoiceAction({ invoiceId, ...v });
            if (!res.ok) return setError(errText(res.error));
            toast.success("Modèle créé : retrouvez-le dans Ventes › Factures récurrentes");
            setOpen(false);
            router.refresh();
          })}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Modification des réglages d'un modèle (fréquence, prochaine échéance, fin, émission et envoi automatiques). */
export function EditRecurringDialog({ id, initial }: { id: string; initial: Values }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="Modifier le modèle"><Pencil className="size-4" /></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Modifier le modèle</DialogTitle><DialogDescription>Les lignes du modèle sont celles de la facture d&apos;origine ; pour les changer, créez un nouveau modèle depuis une facture à jour.</DialogDescription></DialogHeader>
        <Form
          initial={initial} pending={pending} error={error} submitLabel="Enregistrer"
          onSubmit={(v) => start(async () => {
            setError(null);
            const res = await updateRecurringAction({ id, ...v });
            if (!res.ok) return setError(errText(res.error));
            toast.success("Modèle modifié");
            setOpen(false);
            router.refresh();
          })}
        />
      </DialogContent>
    </Dialog>
  );
}
