"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { createCompanyAction } from "@/modules/platform/actions";
import { platformCreateCompanySchema } from "@/modules/platform/schemas";
import { COUNTRIES, CURRENCIES } from "@/lib/reference-data";

type Values = z.input<typeof platformCreateCompanySchema>;

export function CreateCompanyDialog({ plans }: { plans: { code: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, setValue, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(platformCreateCompanySchema),
    defaultValues: { legalName: "", tradeName: "", country: "CI", currency: "XOF", planCode: plans[0]?.code ?? "", adminEmail: "" },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> Nouvelle entreprise</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Créer une entreprise</DialogTitle>
          <DialogDescription>L'administrateur reçoit une invitation par e-mail (ou est rattaché directement s'il a déjà un compte).</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={handleSubmit((v) => start(async () => {
            setFormError(null);
            const res = await createCompanyAction(v);
            if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
            toast.success("Entreprise créée");
            setOpen(false); reset();
            router.push(`/super-admin/entreprises/${res.data.id}`);
          }))}
        >
          <FormAlert message={formError} />
          <Field label="Raison sociale" htmlFor="c-legal" error={errors.legalName?.message}><Input id="c-legal" {...register("legalName")} autoFocus /></Field>
          <Field label="Nom commercial" htmlFor="c-trade" error={errors.tradeName?.message}><Input id="c-trade" {...register("tradeName")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pays" error={errors.country?.message}>
              <Controller control={control} name="country" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => { field.onChange(v); const c = COUNTRIES.find((x) => x.code === v); if (c) setValue("currency", c.currency); }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Devise" error={errors.currency?.message}>
              <Controller control={control} name="currency" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
          </div>
          <Field label="Offre" error={errors.planCode?.message}>
            <Controller control={control} name="planCode" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choisir une offre" /></SelectTrigger>
                <SelectContent>{plans.map((p) => <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="E-mail de l'administrateur" htmlFor="c-admin" error={errors.adminEmail?.message}><Input id="c-admin" type="email" {...register("adminEmail")} /></Field>
          <SubmitButton pending={pending}>Créer l'entreprise</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
