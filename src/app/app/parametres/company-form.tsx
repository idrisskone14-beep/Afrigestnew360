"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { companySettingsSchema } from "@/core/tenant/schemas";
import { updateCompanyAction } from "@/modules/settings/actions";
import { COMPANY_SIZES, COUNTRIES, CURRENCIES, SECTORS } from "@/lib/reference-data";

type Values = z.input<typeof companySettingsSchema>;
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function CompanyForm({ initial, readOnly }: { initial: Values; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, formState: { errors, isDirty } } = useForm<Values>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: initial,
  });

  const select = (name: keyof Values, items: readonly { value: string; label: string }[], placeholder?: string) => (
    <Controller control={control} name={name} render={({ field }) => (
      <Select disabled={readOnly} value={String(field.value ?? "") || undefined} onValueChange={field.onChange}>
        <SelectTrigger className="w-full"><SelectValue placeholder={placeholder ?? "Choisir…"} /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
    )} />
  );

  return (
    <form
      noValidate
      className="grid max-w-4xl gap-6"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          setFormError(null);
          const res = await updateCompanyAction(v);
          if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
          toast.success("Paramètres enregistrés");
          router.refresh();
        }),
      )}
    >
      <FormAlert message={formError} />
      <Card>
        <CardHeader><CardTitle className="text-base">Identité</CardTitle><CardDescription>Ces informations figurent sur vos documents (factures, devis, bulletins).</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Raison sociale" htmlFor="legalName" error={errors.legalName?.message}><Input id="legalName" disabled={readOnly} {...register("legalName")} /></Field>
          <Field label="Nom commercial" htmlFor="tradeName" error={errors.tradeName?.message}><Input id="tradeName" disabled={readOnly} {...register("tradeName")} /></Field>
          <Field label="Forme juridique" htmlFor="legalForm" error={errors.legalForm?.message}><Input id="legalForm" disabled={readOnly} placeholder="SARL, SA, SAS, EI…" {...register("legalForm")} /></Field>
          <Field label="Secteur d'activité" error={errors.sector?.message}>{select("sector", SECTORS.map((s) => ({ value: s, label: s })))}</Field>
          <Field label="Taille de l'entreprise" error={errors.size?.message}>{select("size", COMPANY_SIZES.map((s) => ({ value: s, label: `${s} employés` })))}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Coordonnées</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mail" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" disabled={readOnly} {...register("email")} /></Field>
          <Field label="Téléphone" htmlFor="phone" error={errors.phone?.message}><Input id="phone" disabled={readOnly} {...register("phone")} /></Field>
          <Field label="Adresse" htmlFor="address" className="sm:col-span-2" error={errors.address?.message}><Input id="address" disabled={readOnly} {...register("address")} /></Field>
          <Field label="Ville" htmlFor="city" error={errors.city?.message}><Input id="city" disabled={readOnly} {...register("city")} /></Field>
          <Field label="Pays" error={errors.country?.message}>{select("country", COUNTRIES.map((c) => ({ value: c.code, label: c.name })))}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Informations légales et fiscales</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="RCCM" htmlFor="rccm" error={errors.rccm?.message}><Input id="rccm" disabled={readOnly} {...register("rccm")} /></Field>
          <Field label="Identifiant fiscal" htmlFor="taxId" error={errors.taxId?.message}><Input id="taxId" disabled={readOnly} {...register("taxId")} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Devise, exercice et fuseau horaire</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Devise principale" error={errors.currency?.message}>{select("currency", CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })))}</Field>
          <Field label="Début de l'exercice" error={errors.fiscalYearStartMonth?.message}>
            <Controller control={control} name="fiscalYearStartMonth" render={({ field }) => (
              <Select disabled={readOnly} value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Fuseau horaire" htmlFor="timezone" error={errors.timezone?.message}><Input id="timezone" disabled={readOnly} {...register("timezone")} /></Field>
        </CardContent>
      </Card>

      {readOnly ? (
        <p className="text-sm text-muted-foreground">Vous avez un accès en lecture seule à ces paramètres.</p>
      ) : (
        <div><SubmitButton pending={pending}>{isDirty ? "Enregistrer les modifications" : "Enregistrer"}</SubmitButton></div>
      )}
    </form>
  );
}
