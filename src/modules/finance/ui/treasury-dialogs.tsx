"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeftRight, Pencil, Plus, PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field, FormAlert } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { createAccountAction, createTransactionAction, createTransferAction, updateAccountAction } from "../actions";
import { ACCOUNT_TYPES } from "../schemas";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

export interface AccountOpt { id: string; name: string }
export interface CategoryOpt { id: string; name: string; kind: "INCOME" | "EXPENSE" }

export function AccountFormDialog({ account }: { account?: { id: string; name: string; type: "BANK" | "CASH" | "MOBILE_MONEY"; bankName: string; accountNumber: string; openingBalance: number; isDefault: boolean; isActive: boolean; hasMovements: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const blank = { name: "", type: "BANK", bankName: "", accountNumber: "", openingBalance: "0", isDefault: false, isActive: true };
  const init = account ? { ...account, openingBalance: String(account.openingBalance) } : blank;
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const base = { name: f.name, type: f.type as "BANK", bankName: f.bankName, accountNumber: f.accountNumber, openingBalance: Number(f.openingBalance || 0), isDefault: f.isDefault };
    const res = account ? await updateAccountAction({ ...base, id: account.id, isActive: f.isActive }) : await createAccountAction(base);
    if (!res.ok) return setError(errText(res.error));
    toast.success(account ? "Compte mis à jour" : "Compte créé");
    setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild>{account ? <Button variant="ghost" size="icon" aria-label={`Modifier ${account.name}`}><Pencil className="size-4" /></Button> : <Button><Plus className="size-4" /> Nouveau compte</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{account ? "Modifier le compte" : "Nouveau compte"}</DialogTitle><DialogDescription>Banque, caisse ou compte de mobile money. Les montants sont dans la devise de l'entreprise.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Nom du compte *" htmlFor="ac-name" className="sm:col-span-2"><Input id="ac-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex. Ecobank — compte courant" /></Field>
          <Field label="Type">
            <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })} disabled={Boolean(account)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Solde d'ouverture" htmlFor="ac-open" hint={account?.hasMovements ? "Figé : des mouvements existent." : undefined}><Input id="ac-open" type="number" step="any" value={f.openingBalance} disabled={account?.hasMovements} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} /></Field>
          <Field label="Banque / opérateur" htmlFor="ac-bank"><Input id="ac-bank" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
          <Field label="N° de compte / de téléphone" htmlFor="ac-num"><Input id="ac-num" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.isDefault} onCheckedChange={(v) => setF({ ...f, isDefault: v })} /> Compte par défaut pour ce type (utilisé pour les encaissements et paiements sans compte précisé)</label>
          {account && <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} /> Compte actif</label>}
          <Button className="sm:col-span-2" disabled={pending || f.name.trim().length < 2} onClick={submit}>{account ? "Enregistrer" : "Créer le compte"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TransactionDialog({ accounts, categories, defaultAccountId }: { accounts: AccountOpt[]; categories: CategoryOpt[]; defaultAccountId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { accountId: defaultAccountId ?? accounts[0]?.id ?? "", type: "IN", date: todayInput(), amount: "", description: "", categoryId: "", reference: "" };
  const [f, setF] = useState(init);
  const cats = categories.filter((c) => c.kind === (f.type === "IN" ? "INCOME" : "EXPENSE"));
  const submit = () => start(async () => {
    setError(null);
    const res = await createTransactionAction({ accountId: f.accountId, type: f.type as "IN", date: f.date, amount: Number(f.amount), description: f.description, categoryId: f.categoryId, reference: f.reference });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Mouvement enregistré");
    setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button variant="outline"><PlusCircle className="size-4" /> Saisir un mouvement</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Saisir un mouvement</DialogTitle><DialogDescription>Pour les opérations sans document : apport, frais bancaires, retrait… Les paiements de factures se saisissent depuis la facture.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Sens">
            <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v, categoryId: "" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IN">Entrée d'argent</SelectItem><SelectItem value="OUT">Sortie d'argent</SelectItem></SelectContent></Select>
          </Field>
          <Field label="Compte">
            <Select value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Montant *" htmlFor="tx-amount"><Input id="tx-amount" type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" htmlFor="tx-date"><Input id="tx-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Libellé *" htmlFor="tx-desc" className="sm:col-span-2"><Input id="tx-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Catégorie">
            <Select value={f.categoryId || "none"} onValueChange={(v) => setF({ ...f, categoryId: v === "none" ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sans catégorie</SelectItem>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Référence" htmlFor="tx-ref"><Input id="tx-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || !(Number(f.amount) > 0) || f.description.trim().length < 2} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TransferDialog({ accounts }: { accounts: AccountOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { fromAccountId: accounts[0]?.id ?? "", toAccountId: accounts[1]?.id ?? "", amount: "", date: todayInput(), description: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const res = await createTransferAction({ ...f, amount: Number(f.amount) });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Transfert effectué");
    setOpen(false); router.refresh();
  });
  const pickOpts = (exclude: string) => accounts.filter((a) => a.id !== exclude);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button variant="outline" disabled={accounts.length < 2}><ArrowLeftRight className="size-4" /> Transférer</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Transfert entre comptes</DialogTitle><DialogDescription>Dépôt en banque, approvisionnement de caisse… Deux mouvements liés sont créés ; le solde du compte débité est vérifié.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Du compte"><Select value={f.fromAccountId} onValueChange={(v) => setF({ ...f, fromAccountId: v, toAccountId: v === f.toAccountId ? "" : f.toAccountId })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Vers le compte"><Select value={f.toAccountId || undefined} onValueChange={(v) => setF({ ...f, toAccountId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Choisir…" /></SelectTrigger><SelectContent>{pickOpts(f.fromAccountId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Montant *" htmlFor="tf-amount"><Input id="tf-amount" type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" htmlFor="tf-date"><Input id="tf-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Libellé" htmlFor="tf-desc" className="sm:col-span-2"><Input id="tf-desc" value={f.description} placeholder="Optionnel" onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || !(Number(f.amount) > 0) || !f.toAccountId} onClick={submit}>Transférer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
