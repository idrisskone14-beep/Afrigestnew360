"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightLeft, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, SubmitButton, applyServerErrors, runAction } from "@/components/app/form-kit";
import { convertLeadAction, createLeadAction, deleteLeadAction, updateLeadAction } from "../actions";
import { LEAD_STATUSES, leadSchema } from "../schemas";

type Values = z.input<typeof leadSchema>;
const STATUS_LABEL: Record<string, string> = { NEW: "Nouveau", CONTACTED: "Contacté", QUALIFIED: "Qualifié", LOST: "Perdu" };

export interface LeadRow { id: string; name: string; companyName: string | null; email: string | null; phone: string | null; source: string | null; status: string; estimatedValue: number | null; notes: string | null }

export function LeadFormDialog({ lead, open, onOpenChange }: { lead?: LeadRow; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const router = useRouter();
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const setOpen = onOpenChange ?? setInner;
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState(lead?.status ?? "NEW");
  const defaults: Values = { name: lead?.name ?? "", companyName: lead?.companyName ?? "", email: lead?.email ?? "", phone: lead?.phone ?? "", source: lead?.source ?? "", estimatedValue: lead?.estimatedValue ?? "", notes: lead?.notes ?? "" };
  const { register, handleSubmit, setError, reset, formState: { errors } } = useForm<Values>({ resolver: zodResolver(leadSchema), defaultValues: defaults });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { setOpen(o); if (o) { reset(defaults); setStatus(lead?.status ?? "NEW"); setFormError(null); } }}>
      {!lead && <DialogTrigger asChild><Button><Plus className="size-4" /> Nouveau prospect</Button></DialogTrigger>}
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{lead ? "Modifier le prospect" : "Nouveau prospect"}</DialogTitle><DialogDescription>Un prospect devient client au moment de la conversion.</DialogDescription></DialogHeader>
        <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => start(async () => {
          setFormError(null);
          const res = lead ? await updateLeadAction({ ...v, id: lead.id, status: status as (typeof LEAD_STATUSES)[number] }) : await createLeadAction(v);
          if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
          toast.success(lead ? "Prospect mis à jour" : "Prospect créé");
          setOpen(false); router.refresh();
        }))}>
          <div className="sm:col-span-2"><FormAlert message={formError} /></div>
          <Field label="Nom du contact *" htmlFor="ld-name" error={errors.name?.message}><Input id="ld-name" autoFocus {...register("name")} /></Field>
          <Field label="Entreprise" htmlFor="ld-company" error={errors.companyName?.message}><Input id="ld-company" {...register("companyName")} /></Field>
          <Field label="E-mail" htmlFor="ld-email" error={errors.email?.message}><Input id="ld-email" type="email" {...register("email")} /></Field>
          <Field label="Téléphone" htmlFor="ld-phone" error={errors.phone?.message}><Input id="ld-phone" {...register("phone")} /></Field>
          <Field label="Source" htmlFor="ld-source" hint="Recommandation, salon, site web…" error={errors.source?.message}><Input id="ld-source" {...register("source")} /></Field>
          <Field label="Valeur estimée" htmlFor="ld-value" error={errors.estimatedValue?.message}><Input id="ld-value" type="number" min={0} {...register("estimatedValue")} /></Field>
          {lead && (
            <Field label="Statut" className="sm:col-span-2">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Notes" htmlFor="ld-notes" className="sm:col-span-2" error={errors.notes?.message}><Textarea id="ld-notes" rows={3} {...register("notes")} /></Field>
          <div className="sm:col-span-2"><SubmitButton pending={pending}>{lead ? "Enregistrer" : "Créer le prospect"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeadActions({ lead, can }: { lead: LeadRow; can: { update: boolean; delete: boolean; convert: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [createOpp, setCreateOpp] = useState(true);
  const converted = lead.status === "CONVERTED";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${lead.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.convert && !converted && <DropdownMenuItem onSelect={() => setConvertOpen(true)}><ArrowRightLeft className="size-4" /> Convertir en client</DropdownMenuItem>}
          {can.update && !converted && <DropdownMenuItem onSelect={() => setEditOpen(true)}>Modifier</DropdownMenuItem>}
          {can.delete && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => start(async () => { const r = await runAction(deleteLeadAction({ id: lead.id }), { success: "Prospect supprimé" }); if (r.ok) router.refresh(); })}>Supprimer</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {editOpen && <LeadFormDialog lead={lead} open={editOpen} onOpenChange={setEditOpen} />}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Convertir {lead.name} en client</DialogTitle><DialogDescription>Un client {lead.companyName ? `« ${lead.companyName} »` : ""} est créé avec ses coordonnées{lead.companyName ? " et un contact principal" : ""}. L'historique du prospect est conservé.</DialogDescription></DialogHeader>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={createOpp} onCheckedChange={(v) => setCreateOpp(v === true)} /> Créer aussi une opportunité dans le pipeline</label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>Annuler</Button>
            <Button disabled={pending} onClick={() => start(async () => {
              const r = await runAction(convertLeadAction({ id: lead.id, createOpportunity: createOpp }), { success: "Prospect converti en client" });
              if (r.ok) { setConvertOpen(false); router.push(`/app/crm/clients/${r.data.customerId}`); }
            })}>Convertir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
