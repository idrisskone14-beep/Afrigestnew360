"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BellRing, CheckCircle2, CircleDollarSign, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { splitInstallments } from "@/core/money";
import { todayInput } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { createCreditNoteAction, issueInvoiceAction, recordPaymentAction, remindInvoiceAction } from "../actions";
import { PAYMENT_METHODS } from "../schemas";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

export function IssueInvoiceDialog({ invoiceId, total, currency, canOverride, creditWarning }: { invoiceId: string; total: number; currency: string; canOverride: boolean; creditWarning?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState("1");
  const [override, setOverride] = useState(false);
  const count = Math.min(24, Math.max(1, Number(n) || 1));
  const parts = splitInstallments(total, count, currency);

  const submit = () => start(async () => {
    setError(null);
    const res = await issueInvoiceAction({ id: invoiceId, installments: count, allowOverLimit: override });
    if (!res.ok) return setError(errText(res.error));
    toast.success(`Facture ${res.data.number} émise`);
    setOpen(false); router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button><CheckCircle2 className="size-4" /> Émettre la facture</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Émettre la facture</DialogTitle><DialogDescription>Le numéro définitif est attribué à l'émission, puis la facture n'est plus modifiable (corrigez-la par un avoir).</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Nombre d'échéances" htmlFor="is-n" hint="1 = paiement unique à la date d'échéance ; sinon une échéance tous les 30 jours.">
            <Input id="is-n" type="number" min={1} max={24} value={n} onChange={(e) => setN(e.target.value)} className="w-28" />
          </Field>
          {count > 1 && <ul className="rounded-lg bg-muted/50 p-3 text-sm">{parts.map((p, i) => <li key={i} className="flex justify-between"><span className="text-muted-foreground">Échéance {i + 1}</span><span className="tabular">{formatMoney(p.toNumber(), currency)}</span></li>)}</ul>}
          {creditWarning && <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">{creditWarning}</p>}
          {canOverride && <label className="flex items-center gap-2 text-sm"><Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} /> Autoriser malgré un dépassement du plafond de crédit</label>}
          <Button disabled={pending} onClick={submit}>Émettre ({formatMoney(total, currency)})</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentDialog({ invoiceId, balance, currency, willValidate, accounts }: { invoiceId: string; balance: number; currency: string; willValidate: boolean; accounts?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ amount: String(balance), method: "BANK_TRANSFER", date: todayInput(), reference: "", accountId: "", notes: "" });

  const submit = () => start(async () => {
    setError(null);
    const res = await recordPaymentAction({ invoiceId, amount: Number(f.amount), method: f.method as "CASH", date: f.date, reference: f.reference, accountId: f.accountId, notes: f.notes });
    if (!res.ok) return setError(errText(res.error));
    toast.success(res.data.status === "VALIDATED" ? "Paiement enregistré et validé" : "Paiement enregistré, en attente de validation");
    setOpen(false); router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF((s) => ({ ...s, amount: String(balance) })); } }}>
      <DialogTrigger asChild><Button><CircleDollarSign className="size-4" /> Enregistrer un paiement</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Enregistrer un paiement</DialogTitle><DialogDescription>Reste à payer : {formatMoney(balance, currency)}. {willValidate ? "Le paiement est validé immédiatement." : "Le paiement devra être validé par un responsable avant de réduire le solde."}</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Montant" htmlFor="pm-amount"><Input id="pm-amount" type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Date" htmlFor="pm-date"><Input id="pm-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Mode de paiement">
              <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Référence" htmlFor="pm-ref" hint="N° de chèque, de virement, de transaction…"><Input id="pm-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          </div>
          {accounts && accounts.length > 0 && (
            <Field label="Compte crédité" hint="Vide = compte par défaut du mode de paiement">
              <Select value={f.accountId || "none"} onValueChange={(v) => setF({ ...f, accountId: v === "none" ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Compte par défaut</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
            </Field>
          )}
          <Field label="Notes" htmlFor="pm-notes"><Input id="pm-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Button disabled={pending || !(Number(f.amount) > 0)} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface CreditableLine { id: string; description: string; unit: string; creditable: number; unitPrice: number }

export function CreditNoteDialog({ invoiceId, lines }: { invoiceId: string; lines: CreditableLine[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const any = lines.some((l) => Number(qty[l.id]) > 0);

  const submit = () => start(async () => {
    setError(null);
    const res = await createCreditNoteAction({ invoiceId, reason, restock, lines: lines.map((l) => ({ invoiceLineId: l.id, quantity: Number(qty[l.id] || 0) })) });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Avoir créé (brouillon)");
    setOpen(false);
    router.push(`/app/sales/avoirs/${res.data.id}`);
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="outline"><ReceiptText className="size-4" /> Créer un avoir</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Nouvel avoir</DialogTitle><DialogDescription>Choisissez les quantités à créditer. L'avoir réduit le solde de la facture une fois émis.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <ul className="divide-y rounded-lg border">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{l.description}</p><p className="text-xs text-muted-foreground">Créditable : {l.creditable} {l.unit}</p></div>
                <Input type="number" min={0} max={l.creditable} step="any" disabled={l.creditable <= 0} className="h-9 w-28 text-right" aria-label={`Quantité à créditer ${l.description}`} value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </li>
            ))}
          </ul>
          <Field label="Motif *" htmlFor="cn-reason"><Input id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Retour de marchandise, erreur de prix, geste commercial…" /></Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} /> Remettre les articles en stock (retour de marchandise)</label>
          <Button disabled={pending || !any || reason.trim().length < 3} onClick={submit}>Créer l'avoir</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReminderDialog({ invoiceId, hasEmail, nextLevel }: { invoiceId: string; hasEmail: boolean; nextLevel: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<"EMAIL" | "PHONE" | "MANUAL">(hasEmail ? "EMAIL" : "PHONE");
  const [note, setNote] = useState("");

  const submit = () => start(async () => {
    setError(null);
    const res = await remindInvoiceAction({ invoiceId, channel, note });
    if (!res.ok) return setError(errText(res.error));
    toast.success(channel === "EMAIL" ? "Relance envoyée par e-mail" : "Relance enregistrée");
    setOpen(false); setNote(""); router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><BellRing className="size-4" /> Relancer</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Relance n°{nextLevel}</DialogTitle><DialogDescription>Un e-mail de rappel est envoyé au client, ou la relance est simplement consignée (appel, visite).</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Canal">
            <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="EMAIL" disabled={!hasEmail}>E-mail{hasEmail ? "" : " (pas d'adresse)"}</SelectItem><SelectItem value="PHONE">Appel téléphonique</SelectItem><SelectItem value="MANUAL">Autre (visite, courrier…)</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Note" htmlFor="rm-note"><Input id="rm-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Promesse de paiement, interlocuteur…" /></Field>
          <Button disabled={pending} onClick={submit}>Envoyer / consigner</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
