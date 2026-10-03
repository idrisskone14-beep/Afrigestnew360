"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, CircleDollarSign, PackageCheck, ShoppingCart, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { decideApprovalAction } from "@/modules/workflow/actions";
import { todayInput } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { PAYMENT_METHODS } from "@/modules/sales/schemas";
import { convertRequestAction, createReceiptAction, paySupplierBillAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

/** Transforme une demande approuvée en commande fournisseur (brouillon) : choix du fournisseur. */
export function ConvertRequestDialog({ requestId, suppliers }: { requestId: string; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const submit = () => start(async () => {
    setError(null);
    const res = await convertRequestAction({ requestId, supplierId });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Commande fournisseur créée (brouillon)");
    setOpen(false);
    router.push(`/app/purchases/commandes/${res.data.id}`);
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button><ShoppingCart className="size-4" /> Transformer en commande</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Transformer en commande fournisseur</DialogTitle><DialogDescription>Les articles et les prix estimés sont repris ; vous pourrez ajuster la commande avant de la soumettre.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Fournisseur *">
            <Select value={supplierId || undefined} onValueChange={setSupplierId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choisir un fournisseur…" /></SelectTrigger>
              <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Button disabled={pending || !supplierId} onClick={submit}>Créer la commande</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface ReceivableLine { id: string; description: string; unit: string; remaining: number }

/** Bon de réception : quantités reçues par ligne ; l'entrée en stock a lieu à la confirmation. */
export function CreateReceiptDialog({ orderId, lines, warehouses, defaultWarehouseId }: { orderId: string; lines: ReceivableLine[]; warehouses: { id: string; name: string }[]; defaultWarehouseId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.remaining)])));
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId ?? warehouses[0]?.id ?? "");
  const [date, setDate] = useState(todayInput());
  const [notes, setNotes] = useState("");
  const submit = () => start(async () => {
    setError(null);
    const res = await createReceiptAction({ orderId, warehouseId, receiptDate: date, notes, lines: lines.map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id] || 0) })) });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Bon de réception créé");
    setOpen(false);
    router.push(`/app/purchases/receptions/${res.data.id}`);
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button><PackageCheck className="size-4" /> Réceptionner</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Nouveau bon de réception</DialogTitle><DialogDescription>Indiquez les quantités effectivement reçues. L'entrée en stock (valorisée au coût de la commande) a lieu à la confirmation du bon.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            {warehouses.length > 0 && (
              <Field label="Entrepôt de réception">
                <Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
              </Field>
            )}
            <Field label="Date de réception" htmlFor="rc-date"><Input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <ul className="divide-y rounded-lg border">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{l.description}</p><p className="text-xs text-muted-foreground">Reste à recevoir : {l.remaining} {l.unit}</p></div>
                <Input type="number" min={0} max={l.remaining} step="any" className="h-9 w-28 text-right" aria-label={`Quantité reçue ${l.description}`} value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </li>
            ))}
          </ul>
          <Field label="Notes" htmlFor="rc-notes"><Input id="rc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Button disabled={pending || lines.every((l) => !Number(qty[l.id]))} onClick={submit}>Créer le bon de réception</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierPaymentDialog({ billId, balance, currency, accounts }: { billId: string; balance: number; currency: string; accounts?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ amount: String(balance), method: "BANK_TRANSFER", date: todayInput(), reference: "", accountId: "", notes: "" });
  const submit = () => start(async () => {
    setError(null);
    const res = await paySupplierBillAction({ billId, amount: Number(f.amount), method: f.method as "CASH", date: f.date, reference: f.reference, accountId: f.accountId, notes: f.notes });
    if (!res.ok) return setError(errText(res.error));
    toast.success(res.data.pendingApproval ? "Paiement soumis à validation : il sera effectué après approbation" : "Paiement enregistré");
    setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF((s) => ({ ...s, amount: String(balance) })); } }}>
      <DialogTrigger asChild><Button><CircleDollarSign className="size-4" /> Payer</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Régler la facture fournisseur</DialogTitle><DialogDescription>Reste à payer : {formatMoney(balance, currency)}. Le paiement est enregistré immédiatement.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Montant" htmlFor="sp-amount"><Input id="sp-amount" type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Date" htmlFor="sp-date"><Input id="sp-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Mode de paiement">
              <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Référence" htmlFor="sp-ref" hint="N° de chèque, de virement…"><Input id="sp-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            {accounts && accounts.length > 0 && (
              <Field label="Compte débité" className="sm:col-span-2">
                <Select value={f.accountId || "none"} onValueChange={(v) => setF({ ...f, accountId: v === "none" ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Non précisé</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
              </Field>
            )}
          </div>
          <Field label="Notes" htmlFor="sp-notes"><Input id="sp-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Button disabled={pending || !(Number(f.amount) > 0)} onClick={submit}>Enregistrer le paiement</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Valider / refuser une demande d'approbation (motif obligatoire pour un refus). */
export function DecisionButtons({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = (decision: "APPROVED" | "REJECTED") => start(async () => {
    setError(null);
    const res = await decideApprovalAction({ id, decision, comment });
    if (!res.ok) { if (decision === "REJECTED") return setError(errText(res.error)); toast.error(res.error.message); return; }
    toast.success(decision === "APPROVED" ? "Demande validée" : "Demande refusée");
    setOpen(false); router.refresh();
  });
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => decide("APPROVED")}><Check className="size-4" /> Valider</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setComment(""); } }}>
        <DialogTrigger asChild><Button size="sm" variant="outline" disabled={pending}><X className="size-4" /> Refuser</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Refuser « {title} »</DialogTitle><DialogDescription>Le demandeur sera notifié avec votre motif.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <FormAlert message={error} />
            <Field label="Motif du refus *" htmlFor="dc-comment"><Input id="dc-comment" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <Button variant="destructive" disabled={pending || !comment.trim()} onClick={() => decide("REJECTED")}>Confirmer le refus</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
