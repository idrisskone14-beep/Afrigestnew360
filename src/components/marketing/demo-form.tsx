"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { submitDemoRequestAction } from "@/modules/marketing/actions";
import { demoRequestSchema, type DemoRequestInput } from "@/modules/marketing/schemas";
import { COMPANY_SIZES, COUNTRIES, SECTORS } from "@/lib/reference-data";

export function DemoForm({ source = "demo", plan, submitLabel = "Demander ma démonstration", messageLabel = "Votre besoin (optionnel)" }: {
  source?: "demo" | "contact" | "tarifs";
  plan?: string;
  submitLabel?: string;
  messageLabel?: string;
}) {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<DemoRequestInput>({
    resolver: zodResolver(demoRequestSchema),
    defaultValues: {
      fullName: "", email: "", phone: "", companyName: "", country: "", sector: "", companySize: "", source,
      message: plan ? `Offre qui m'intéresse : ${plan}.\n` : "", consent: false as unknown as true, website: "",
    },
  });

  if (done) {
    return (
      <div role="status" className="rounded-2xl border bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto size-12 text-brand-green" />
        <h3 className="mt-4 text-xl font-semibold">Merci, votre demande est enregistrée</h3>
        <p className="mt-2 text-sm text-muted-foreground">Un conseiller AfriGest 360 vous recontacte très prochainement. Une confirmation vous a été envoyée par e-mail.</p>
      </div>
    );
  }

  const select = (name: "country" | "sector" | "companySize", items: { value: string; label: string }[], placeholder: string) => (
    <Controller control={control} name={name} render={({ field }) => (
      <Select value={field.value || undefined} onValueChange={field.onChange}>
        <SelectTrigger className="w-full" aria-label={placeholder}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
    )} />
  );

  return (
    <form
      noValidate
      className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 sm:p-7"
      onSubmit={handleSubmit((v) => start(async () => {
        setFormError(null);
        const res = await submitDemoRequestAction(v);
        if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
        setDone(true);
      }))}
    >
      <div className="sm:col-span-2"><FormAlert message={formError} /></div>
      <Field label="Nom complet *" htmlFor="d-name" error={errors.fullName?.message}><Input id="d-name" autoComplete="name" {...register("fullName")} /></Field>
      <Field label="E-mail professionnel *" htmlFor="d-email" error={errors.email?.message}><Input id="d-email" type="email" autoComplete="email" {...register("email")} /></Field>
      <Field label="Téléphone / WhatsApp" htmlFor="d-phone" error={errors.phone?.message}><Input id="d-phone" type="tel" autoComplete="tel" {...register("phone")} /></Field>
      <Field label="Entreprise *" htmlFor="d-company" error={errors.companyName?.message}><Input id="d-company" autoComplete="organization" {...register("companyName")} /></Field>
      <Field label="Pays" error={errors.country?.message}>{select("country", COUNTRIES.map((c) => ({ value: c.code, label: c.name })), "Choisir un pays")}</Field>
      <Field label="Secteur d'activité" error={errors.sector?.message}>{select("sector", SECTORS.map((s) => ({ value: s, label: s })), "Choisir un secteur")}</Field>
      <Field label="Taille de l'entreprise" error={errors.companySize?.message} className="sm:col-span-2">{select("companySize", COMPANY_SIZES.map((s) => ({ value: s, label: `${s} employés` })), "Nombre d'employés")}</Field>
      <Field label={messageLabel} htmlFor="d-msg" error={errors.message?.message} className="sm:col-span-2"><Textarea id="d-msg" rows={4} {...register("message")} /></Field>
      {/* Champ piège anti-spam : masqué aux humains et aux lecteurs d'écran */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Ne pas remplir<input type="text" tabIndex={-1} autoComplete="off" {...register("website")} /></label>
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <label className="flex items-start gap-2.5 text-sm">
          <Controller control={control} name="consent" render={({ field }) => <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />} />
          <span className="text-muted-foreground">J'accepte d'être recontacté(e) par AfriGest 360 au sujet de ma demande.</span>
        </label>
        {errors.consent && <p role="alert" className="text-xs text-destructive">{errors.consent.message}</p>}
      </div>
      <div className="sm:col-span-2"><SubmitButton pending={pending} className="w-full sm:w-auto" size="lg">{submitLabel}</SubmitButton></div>
    </form>
  );
}
