"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FilePlus2, LogOut, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { addContractAction, createEmployeeAction, terminateEmployeeAction, updateEmployeeAction } from "../actions";
import { CONTRACT_TYPES, PAYOUT_METHODS } from "../schemas";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);
const NONE = "__none";
type Opt = { id: string; name: string };

export interface EmployeeInit {
  id?: string; firstName: string; lastName: string; email: string; phone: string; birthDate: string; nationalId: string; address: string; city: string; hireDate: string; jobTitle: string;
  departmentId: string; branchId: string; managerId: string; userId: string; baseSalary: number; payoutMethod: string; payoutReference: string;
}
const BLANK: EmployeeInit = { firstName: "", lastName: "", email: "", phone: "", birthDate: "", nationalId: "", address: "", city: "", hireDate: todayInput(), jobTitle: "", departmentId: "", branchId: "", managerId: "", userId: "", baseSalary: 0, payoutMethod: "BANK_TRANSFER", payoutReference: "" };

function PickField({ label, value, onChange, options, none = "— Aucun —" }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; none?: string }) {
  return (
    <Field label={label}>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={NONE}>{none}</SelectItem>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

export function EmployeeFormDialog({ employee, departments, branches, managers, users, canPay }: { employee?: EmployeeInit; departments: Opt[]; branches: Opt[]; managers: Opt[]; users: Opt[]; canPay: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = employee ?? BLANK;
  const [f, setF] = useState<EmployeeInit>(init);
  const set = <K extends keyof EmployeeInit>(k: K, v: EmployeeInit[K]) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => start(async () => {
    setError(null);
    const payload = { ...f, baseSalary: Number(f.baseSalary || 0) };
    const res = employee ? await updateEmployeeAction({ ...payload, id: employee.id! } as never) : await createEmployeeAction(payload as never);
    if (!res.ok) return setError(errText(res.error));
    toast.success(employee ? "Fiche mise à jour" : "Salarié enregistré");
    setOpen(false);
    if (!employee && res.data) router.push(`/app/hr/salaries/${(res.data as { id: string }).id}`); else router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild>{employee ? <Button variant="outline"><Pencil className="size-4" /> Modifier</Button> : <Button><Plus className="size-4" /> Nouveau salarié</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{employee ? "Modifier la fiche" : "Nouveau salarié"}</DialogTitle><DialogDescription>Le matricule est attribué automatiquement.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Prénom *" htmlFor="em-fn"><Input id="em-fn" value={f.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Nom *" htmlFor="em-ln"><Input id="em-ln" value={f.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
          <Field label="E-mail" htmlFor="em-mail"><Input id="em-mail" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Téléphone" htmlFor="em-tel"><Input id="em-tel" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Date de naissance" htmlFor="em-bd"><Input id="em-bd" type="date" value={f.birthDate} onChange={(e) => set("birthDate", e.target.value)} /></Field>
          <Field label="Date d'embauche *" htmlFor="em-hd"><Input id="em-hd" type="date" value={f.hireDate} onChange={(e) => set("hireDate", e.target.value)} /></Field>
          <Field label="Adresse" htmlFor="em-ad"><Input id="em-ad" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Ville" htmlFor="em-ci"><Input id="em-ci" value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Poste" htmlFor="em-job" className="sm:col-span-2"><Input id="em-job" value={f.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} /></Field>
          <PickField label="Département" value={f.departmentId} onChange={(v) => set("departmentId", v)} options={departments} />
          <PickField label="Agence" value={f.branchId} onChange={(v) => set("branchId", v)} options={branches} />
          <PickField label="Responsable hiérarchique" value={f.managerId} onChange={(v) => set("managerId", v)} options={managers.filter((m) => m.id !== employee?.id)} />
          <PickField label="Compte utilisateur lié" value={f.userId} onChange={(v) => set("userId", v)} options={users} none="— Aucun accès —" />
          {canPay && (
            <>
              <Field label="Salaire de base mensuel brut" htmlFor="em-sal" hint="Donnée sensible (visible des profils contrats et paie)"><Input id="em-sal" type="number" min={0} step="any" value={f.baseSalary} onChange={(e) => set("baseSalary", Number(e.target.value))} /></Field>
              <Field label="Pièce d'identité" htmlFor="em-nid"><Input id="em-nid" value={f.nationalId} onChange={(e) => set("nationalId", e.target.value)} /></Field>
              <Field label="Mode de paiement du salaire"><Select value={f.payoutMethod} onValueChange={(v) => set("payoutMethod", v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYOUT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="IBAN / n° de compte / téléphone" htmlFor="em-pr"><Input id="em-pr" value={f.payoutReference} onChange={(e) => set("payoutReference", e.target.value)} /></Field>
            </>
          )}
          <Button className="sm:col-span-2" disabled={pending || !f.firstName.trim() || !f.lastName.trim() || !f.hireDate} onClick={submit}>{employee ? "Enregistrer" : "Créer le salarié"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ContractDialog({ employeeId, currentSalary }: { employeeId: string; currentSalary: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { type: "PERMANENT", startDate: todayInput(), endDate: "", jobTitle: "", salary: String(currentSalary || ""), notes: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const res = await addContractAction({ employeeId, type: f.type as "PERMANENT", startDate: f.startDate, endDate: f.endDate, jobTitle: f.jobTitle, salary: Number(f.salary || 0), notes: f.notes });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Contrat enregistré"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><FilePlus2 className="size-4" /> Nouveau contrat</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouveau contrat</DialogTitle><DialogDescription>Le contrat en cours est clôturé la veille et le salaire de base du salarié est mis à jour.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Type"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Salaire de base mensuel brut" htmlFor="ct-sal"><Input id="ct-sal" type="number" min={0} step="any" value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /></Field>
          <Field label="Début" htmlFor="ct-start"><Input id="ct-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Fin" htmlFor="ct-end" hint="Obligatoire pour un CDD"><Input id="ct-end" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Poste" htmlFor="ct-job" className="sm:col-span-2"><Input id="ct-job" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></Field>
          <Field label="Notes" htmlFor="ct-notes" className="sm:col-span-2"><Textarea id="ct-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || !(Number(f.salary) >= 0) || !f.startDate} onClick={submit}>Enregistrer le contrat</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TerminateDialog({ employeeId, name }: { employeeId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ endDate: todayInput(), reason: "" });
  const submit = () => start(async () => {
    setError(null);
    const res = await terminateEmployeeAction({ id: employeeId, ...f });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Sortie enregistrée"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="outline" className="text-destructive hover:text-destructive"><LogOut className="size-4" /> Enregistrer la sortie</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Sortie de {name}</DialogTitle><DialogDescription>Les contrats en cours sont clôturés et les demandes de congé en attente annulées. La fiche n'est plus modifiable ensuite.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Date de sortie" htmlFor="tm-date"><Input id="tm-date" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Motif" htmlFor="tm-reason"><Input id="tm-reason" value={f.reason} placeholder="Démission, fin de contrat…" onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Button variant="destructive" disabled={pending || !f.endDate} onClick={submit}>Confirmer la sortie</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
