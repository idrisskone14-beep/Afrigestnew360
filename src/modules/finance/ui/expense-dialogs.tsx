"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CircleDollarSign, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { PAYMENT_METHODS } from "@/modules/sales/schemas";
import { createExpenseAction, payExpenseAction, updateExpenseAction } from "../actions";

const NONE = "none";
const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

interface ExpenseInit { id: string; date: string; categoryId: string; supplierId: string; description: string; amount: number; method: string; reference: string; notes: string; branchId: string; costCenterId: string; projectId: string }

export function ExpenseFormDialog({ categories, suppliers, branches = [], costCenters = [], projects = [], expense }: { categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; branches?: { id: string; name: string }[]; costCenters?: { id: string; name: string }[]; projects?: { id: string; name: string }[]; expense?: ExpenseInit }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = expense ? { ...expense, amount: String(expense.amount) } : { date: todayInput(), categoryId: "", supplierId: "", description: "", amount: "", method: "CASH", reference: "", notes: "", branchId: "", costCenterId: "", projectId: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const payload = { date: f.date, categoryId: f.categoryId, supplierId: f.supplierId, description: f.description, amount: Number(f.amount), method: f.method as "CASH", reference: f.reference, notes: f.notes, branchId: f.branchId, costCenterId: f.costCenterId, projectId: f.projectId };
    const res = expense ? await updateExpenseAction({ ...payload, id: expense.id }) : await createExpenseAction(payload);
    if (!res.ok) return setError(errText(res.error));
    toast.success(expense ? "Dépense mise à jour" : "Dépense enregistrée (brouillon)");
    setOpen(false);
    if (!expense && res.data) router.push(`/app/finance/depenses/${(res.data as { id: string }).id}`);
    else router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild>{expense ? <Button variant="outline"><Pencil className="size-4" /> Modifier</Button> : <Button><Plus className="size-4" /> Nouvelle dépense</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{expense ? "Modifier la dépense" : "Nouvelle dépense"}</DialogTitle><DialogDescription>La dépense est créée en brouillon ; elle est ensuite soumise, approuvée si nécessaire, puis payée depuis un compte.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Libellé *" htmlFor="ex-desc" className="sm:col-span-2"><Input id="ex-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="ex. Facture d'électricité de septembre" /></Field>
          <Field label="Catégorie *"><Select value={f.categoryId || undefined} onValueChange={(v) => setF({ ...f, categoryId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Choisir…" /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Fournisseur"><Select value={f.supplierId || "none"} onValueChange={(v) => setF({ ...f, supplierId: v === "none" ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Aucun</SelectItem>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Montant TTC *" htmlFor="ex-amount"><Input id="ex-amount" type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" htmlFor="ex-date"><Input id="ex-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Mode de paiement prévu"><Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="N° de pièce" htmlFor="ex-ref"><Input id="ex-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          {branches.length > 0 && <Field label="Agence"><Select value={f.branchId || "none"} onValueChange={(v) => setF({ ...f, branchId: v === "none" ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Non affectée</SelectItem>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></Field>}
          {costCenters.length > 0 && <Field label="Centre de coûts"><Select value={f.costCenterId || "none"} onValueChange={(v) => setF({ ...f, costCenterId: v === "none" ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Non affecté</SelectItem>{costCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></Field>}
          {projects.length > 0 && <Field label="Projet"><Select value={f.projectId || NONE} onValueChange={(v) => setF({ ...f, projectId: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Aucun projet</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></Field>}
          <Field label="Notes" htmlFor="ex-notes" className="sm:col-span-2"><Textarea id="ex-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || !f.categoryId || f.description.trim().length < 2 || !(Number(f.amount) > 0)} onClick={submit}>{expense ? "Enregistrer" : "Créer la dépense"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PayExpenseDialog({ expenseId, amount, currency, method, accounts }: { expenseId: string; amount: number; currency: string; method: string; accounts: { id: string; name: string; balance: number; type: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wanted = method === "CASH" ? "CASH" : method === "MOBILE_MONEY" ? "MOBILE_MONEY" : "BANK";
  const init = { accountId: (accounts.find((a) => a.type === wanted) ?? accounts[0])?.id ?? "", date: todayInput(), method, reference: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const res = await payExpenseAction({ id: expenseId, accountId: f.accountId, date: f.date, method: f.method as "CASH", reference: f.reference });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Dépense payée");
    setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button><CircleDollarSign className="size-4" /> Payer</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Payer la dépense</DialogTitle><DialogDescription>Montant : {formatMoney(amount, currency)}. Une sortie de trésorerie est enregistrée sur le compte choisi.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Compte débité" className="sm:col-span-2"><Select value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} — {formatMoney(a.balance, currency)}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Date" htmlFor="pe-date"><Input id="pe-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Mode"><Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Référence du règlement" htmlFor="pe-ref" className="sm:col-span-2"><Input id="pe-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || !f.accountId} onClick={submit}>Confirmer le paiement</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
