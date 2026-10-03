"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { COUNTRIES } from "@/lib/reference-data";
import { createCustomerAction, updateCustomerAction } from "../actions";
import { customerSchema, type CustomerInput } from "../schemas";

const EMPTY: CustomerInput = {
  type: "COMPANY", name: "", email: "", phone: "", address: "", city: "", country: "", taxId: "", rccm: "", website: "", paymentTermsDays: 30, creditLimit: "", notes: "",
};

export function CustomerFormDialog({ customerId, initial, isActive = true, defaultCountry }: { customerId?: string; initial?: CustomerInput; isActive?: boolean; defaultCountry?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(customerId);
  const { register, control, handleSubmit, setError, reset, formState: { errors } } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: initial ?? { ...EMPTY, country: defaultCountry ?? "" },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { reset(initial ?? { ...EMPTY, country: defaultCountry ?? "" }); setFormError(null); } }}>
      <DialogTrigger asChild>
        {editing ? <Button variant="outline"><Pencil className="size-4" /> Modifier</Button> : <Button><Plus className="size-4" /> Nouveau client</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le client" : "Nouveau client"}</DialogTitle>
          <DialogDescription>Le code client est attribué automatiquement.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit((v) => start(async () => {
            setFormError(null);
            const res = editing ? await updateCustomerAction({ ...v, id: customerId!, isActive }) : await createCustomerAction(v);
            if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
            toast.success(editing ? "Client mis à jour" : "Client créé");
            setOpen(false);
            if (!editing && res.ok && res.data) router.push(`/app/crm/clients/${(res.data as { id: string }).id}`);
            else router.refresh();
          }))}
        >
          <div className="sm:col-span-2"><FormAlert message={formError} /></div>
          <Field label="Type" error={errors.type?.message}>
            <Controller control={control} name="type" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="COMPANY">Entreprise</SelectItem><SelectItem value="INDIVIDUAL">Particulier</SelectItem></SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Nom / raison sociale *" htmlFor="cu-name" error={errors.name?.message}><Input id="cu-name" autoFocus {...register("name")} /></Field>
          <Field label="E-mail" htmlFor="cu-email" error={errors.email?.message}><Input id="cu-email" type="email" {...register("email")} /></Field>
          <Field label="Téléphone" htmlFor="cu-phone" error={errors.phone?.message}><Input id="cu-phone" type="tel" {...register("phone")} /></Field>
          <Field label="Adresse" htmlFor="cu-addr" className="sm:col-span-2" error={errors.address?.message}><Input id="cu-addr" {...register("address")} /></Field>
          <Field label="Ville" htmlFor="cu-city" error={errors.city?.message}><Input id="cu-city" {...register("city")} /></Field>
          <Field label="Pays" error={errors.country?.message}>
            <Controller control={control} name="country" render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Identifiant fiscal" htmlFor="cu-tax" error={errors.taxId?.message}><Input id="cu-tax" {...register("taxId")} /></Field>
          <Field label="RCCM" htmlFor="cu-rccm" error={errors.rccm?.message}><Input id="cu-rccm" {...register("rccm")} /></Field>
          <Field label="Délai de paiement (jours)" htmlFor="cu-terms" error={errors.paymentTermsDays?.message}><Input id="cu-terms" type="number" min={0} {...register("paymentTermsDays")} /></Field>
          <Field label="Plafond de crédit" htmlFor="cu-credit" hint="Laisser vide = sans plafond" error={errors.creditLimit?.message}><Input id="cu-credit" type="number" min={0} {...register("creditLimit")} /></Field>
          <Field label="Notes" htmlFor="cu-notes" className="sm:col-span-2" error={errors.notes?.message}><Textarea id="cu-notes" rows={3} {...register("notes")} /></Field>
          <div className="sm:col-span-2"><SubmitButton pending={pending}>{editing ? "Enregistrer" : "Créer le client"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
