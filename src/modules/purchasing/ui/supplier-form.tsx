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
import { createSupplierAction, updateSupplierAction } from "../actions";
import { supplierSchema, type SupplierInput } from "../schemas";

const EMPTY: SupplierInput = { name: "", email: "", phone: "", address: "", city: "", country: "", taxId: "", rccm: "", paymentTermsDays: 30, notes: "" };

export function SupplierFormDialog({ supplierId, initial, isActive = true, defaultCountry }: { supplierId?: string; initial?: SupplierInput; isActive?: boolean; defaultCountry?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(supplierId);
  const { register, control, handleSubmit, setError, reset, formState: { errors } } = useForm<SupplierInput>({
    resolver: zodResolver(supplierSchema) as never,
    defaultValues: initial ?? { ...EMPTY, country: defaultCountry ?? "" },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { reset(initial ?? { ...EMPTY, country: defaultCountry ?? "" }); setFormError(null); } }}>
      <DialogTrigger asChild>
        {editing ? <Button variant="outline"><Pencil className="size-4" /> Modifier</Button> : <Button><Plus className="size-4" /> Nouveau fournisseur</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le fournisseur" : "Nouveau fournisseur"}</DialogTitle>
          <DialogDescription>Le code fournisseur est attribué automatiquement.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit((v) => start(async () => {
            setFormError(null);
            const res = editing ? await updateSupplierAction({ ...v, id: supplierId!, isActive }) : await createSupplierAction(v);
            if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
            toast.success(editing ? "Fournisseur mis à jour" : "Fournisseur créé");
            setOpen(false);
            if (!editing && res.data) router.push(`/app/purchases/fournisseurs/${(res.data as { id: string }).id}`);
            else router.refresh();
          }))}
        >
          <div className="sm:col-span-2"><FormAlert message={formError} /></div>
          <Field label="Nom / raison sociale *" htmlFor="su-name" className="sm:col-span-2" error={errors.name?.message}><Input id="su-name" autoFocus {...register("name")} /></Field>
          <Field label="E-mail" htmlFor="su-email" error={errors.email?.message}><Input id="su-email" type="email" {...register("email")} /></Field>
          <Field label="Téléphone" htmlFor="su-phone" error={errors.phone?.message}><Input id="su-phone" type="tel" {...register("phone")} /></Field>
          <Field label="Adresse" htmlFor="su-addr" className="sm:col-span-2" error={errors.address?.message}><Input id="su-addr" {...register("address")} /></Field>
          <Field label="Ville" htmlFor="su-city" error={errors.city?.message}><Input id="su-city" {...register("city")} /></Field>
          <Field label="Pays" error={errors.country?.message}>
            <Controller control={control} name="country" render={({ field }) => (
              <Select value={field.value || undefined} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Identifiant fiscal" htmlFor="su-tax" error={errors.taxId?.message}><Input id="su-tax" {...register("taxId")} /></Field>
          <Field label="RCCM" htmlFor="su-rccm" error={errors.rccm?.message}><Input id="su-rccm" {...register("rccm")} /></Field>
          <Field label="Délai de paiement (jours)" htmlFor="su-terms" error={errors.paymentTermsDays?.message}><Input id="su-terms" type="number" min={0} {...register("paymentTermsDays")} /></Field>
          <Field label="Notes" htmlFor="su-notes" className="sm:col-span-2" error={errors.notes?.message}><Textarea id="su-notes" rows={3} {...register("notes")} /></Field>
          <div className="sm:col-span-2"><SubmitButton pending={pending}>{editing ? "Enregistrer" : "Créer le fournisseur"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
