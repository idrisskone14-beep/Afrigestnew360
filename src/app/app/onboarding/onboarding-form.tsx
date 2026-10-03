"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { LogoPicker } from "@/components/app/logo-uploader";
import { createCompanyAction } from "@/core/tenant/onboarding-actions";
import { onboardingSchema, type OnboardingInput } from "@/core/tenant/schemas";
import { uploadCompanyLogoAction } from "@/modules/settings/logo-actions";
import { COMPANY_SIZES, COUNTRIES, CURRENCIES, SECTORS, countryName } from "@/lib/reference-data";
import { cn } from "@/lib/utils";

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const STEPS: { title: string; hint: string; fields: FieldPath<OnboardingInput>[] }[] = [
  { title: "Vous", hint: "Informations personnelles", fields: ["fullName", "phone"] },
  { title: "Entreprise", hint: "Création de l'entreprise", fields: ["legalName", "tradeName", "email", "companyPhone"] },
  { title: "Légal", hint: "Informations légales et fiscales", fields: ["legalForm", "rccm", "taxId"] },
  { title: "Secteur", hint: "Secteur d'activité", fields: ["sector"] },
  { title: "Taille", hint: "Taille de l'entreprise", fields: ["size"] },
  { title: "Devise", hint: "Devise principale", fields: ["currency"] },
  { title: "Pays", hint: "Pays d'implantation", fields: ["country"] },
  { title: "Logo", hint: "Logo de l'entreprise", fields: [] },
  { title: "Adresse", hint: "Adresse du siège", fields: ["address", "city"] },
  { title: "Démarrage", hint: "Configuration initiale", fields: ["fiscalYearStartMonth"] },
];

export function OnboardingForm({ defaultName, isFirst }: { defaultName: string; isFirst: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  const [logo, setLogo] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const { register, control, handleSubmit, setError, setValue, trigger, formState: { errors } } = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      fullName: defaultName, phone: "", legalName: "", tradeName: "", email: "", companyPhone: "", legalForm: "", rccm: "", taxId: "",
      sector: "", size: "", currency: "XOF", country: "CI", address: "", city: "", fiscalYearStartMonth: 1,
    },
  });

  const last = step === STEPS.length - 1;
  const current = STEPS[step]!;
  const values = useWatch({ control });

  const next = async () => {
    if (await trigger(current.fields)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = handleSubmit((v) =>
    start(async () => {
      setFormError(null);
      const res = await createCompanyAction(v);
      if (!res.ok) {
        const msg = applyServerErrors(res.error, setError);
        const failing = STEPS.findIndex((s) => s.fields.some((f) => res.error.fieldErrors?.[f]));
        if (failing >= 0) setStep(failing);
        return setFormError(msg);
      }
      if (logo) {
        const fd = new FormData();
        fd.append("logo", logo);
        const up = await uploadCompanyLogoAction(fd);
        if (!up.ok) toast.warning(`Entreprise créée, mais le logo n'a pas été enregistré : ${up.error.message} Réessayez dans Paramètres.`);
      }
      router.push("/app/dashboard");
      router.refresh();
    }),
  );

  const select = (name: "sector" | "size" | "country" | "currency", items: { value: string; label: string }[], onChange?: (v: string) => void) => (
    <Controller control={control} name={name} render={({ field }) => (
      <Select value={(field.value as string) || undefined} onValueChange={(v) => { field.onChange(v); onChange?.(v); }}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Choisir…" /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
    )} />
  );

  return (
    <div>
      <ol className="mb-6 flex items-center gap-1" aria-label="Progression">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex-1" aria-current={i === step ? "step" : undefined}>
            <span className={cn("block h-1.5 rounded-full transition-colors", i < step ? "bg-brand" : i === step ? "bg-brand/60" : "bg-muted")} />
            <span className="sr-only">{s.hint}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs font-medium text-muted-foreground">Étape {step + 1} sur {STEPS.length} · {current.title}</p>
      <h2 className="mt-1 text-lg font-semibold">{current.hint}</h2>

      <form
        noValidate
        className="mt-5 grid gap-4"
        onSubmit={(e) => { e.preventDefault(); if (last) void submit(); else void next(); }}
      >
        <FormAlert message={formError} />

        {step === 0 && (<>
          <Field label="Nom complet" htmlFor="fullName" error={errors.fullName?.message}><Input id="fullName" autoComplete="name" autoFocus {...register("fullName")} /></Field>
          <Field label="Téléphone (optionnel)" htmlFor="phone" error={errors.phone?.message}><Input id="phone" type="tel" autoComplete="tel" {...register("phone")} /></Field>
        </>)}

        {step === 1 && (<>
          <Field label="Raison sociale" htmlFor="legalName" error={errors.legalName?.message}><Input id="legalName" autoFocus placeholder="ex. AFRICA BUSINESS SARL" {...register("legalName")} /></Field>
          <Field label="Nom commercial (optionnel)" htmlFor="tradeName" error={errors.tradeName?.message}><Input id="tradeName" {...register("tradeName")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="E-mail de l'entreprise" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" {...register("email")} /></Field>
            <Field label="Téléphone de l'entreprise" htmlFor="companyPhone" error={errors.companyPhone?.message}><Input id="companyPhone" type="tel" {...register("companyPhone")} /></Field>
          </div>
        </>)}

        {step === 2 && (<>
          <Field label="Forme juridique" htmlFor="legalForm" hint="SARL, SA, SAS, entreprise individuelle…" error={errors.legalForm?.message}><Input id="legalForm" autoFocus {...register("legalForm")} /></Field>
          <Field label="RCCM" htmlFor="rccm" error={errors.rccm?.message}><Input id="rccm" {...register("rccm")} /></Field>
          <Field label="Identifiant fiscal" htmlFor="taxId" error={errors.taxId?.message}><Input id="taxId" {...register("taxId")} /></Field>
          <p className="text-xs text-muted-foreground">Facultatif maintenant : vous pourrez compléter ces informations dans Paramètres.</p>
        </>)}

        {step === 3 && <Field label="Secteur d'activité" error={errors.sector?.message}>{select("sector", SECTORS.map((s) => ({ value: s, label: s })))}</Field>}
        {step === 4 && <Field label="Nombre d'employés" error={errors.size?.message}>{select("size", COMPANY_SIZES.map((s) => ({ value: s, label: `${s} employés` })))}</Field>}
        {step === 5 && (
          <Field label="Devise principale" hint="Vos documents et rapports utiliseront cette devise. Le FCFA est proposé par défaut." error={errors.currency?.message}>
            {select("currency", CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })), () => setCurrencyTouched(true))}
          </Field>
        )}
        {step === 6 && (
          <Field label="Pays" error={errors.country?.message} hint={!currencyTouched ? "La devise sera ajustée automatiquement selon le pays." : undefined}>
            {select("country", COUNTRIES.map((c) => ({ value: c.code, label: c.name })), (v) => {
              const c = COUNTRIES.find((x) => x.code === v);
              if (c && !currencyTouched) setValue("currency", c.currency);
            })}
          </Field>
        )}
        {step === 7 && <LogoPicker value={logo} onChange={setLogo} />}
        {step === 8 && (<>
          <Field label="Adresse" htmlFor="address" error={errors.address?.message}><Input id="address" autoFocus autoComplete="street-address" {...register("address")} /></Field>
          <Field label="Ville" htmlFor="city" error={errors.city?.message}><Input id="city" autoComplete="address-level2" {...register("city")} /></Field>
        </>)}
        {step === 9 && (<>
          <Field label="Début de l'exercice comptable" error={errors.fiscalYearStartMonth?.message}>
            <Controller control={control} name="fiscalYearStartMonth" render={({ field }) => (
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <dl className="grid gap-x-4 gap-y-2 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Entreprise</dt><dd className="font-medium">{values.tradeName || values.legalName || "—"}</dd>
            <dt className="text-muted-foreground">Pays · devise</dt><dd>{countryName(values.country ?? "CI")} · {values.currency}</dd>
            <dt className="text-muted-foreground">Secteur</dt><dd>{values.sector || "—"}{values.size ? ` · ${values.size} employés` : ""}</dd>
            <dt className="text-muted-foreground">Offre</dt><dd>Starter — essai gratuit (modifiable ensuite)</dd>
          </dl>
          <p className="text-xs text-muted-foreground">Rôles par défaut, siège et modules de votre offre seront créés automatiquement ; vous serez administrateur.</p>
        </>)}

        <div className="mt-2 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending}><ArrowLeft className="size-4" /> Retour</Button>
          <div className="flex items-center gap-2">
            {(step === 7 || step === 2) && <Button type="button" variant="outline" onClick={() => setStep((s) => s + 1)}>Passer</Button>}
            {last ? (
              <SubmitButton pending={pending}><Check className="size-4" /> Créer mon entreprise</SubmitButton>
            ) : (
              <Button type="submit">Continuer <ArrowRight className="size-4" /></Button>
            )}
          </div>
        </div>
        {isFirst && step === 0 && <p className="text-center text-xs text-muted-foreground">Vous pourrez modifier ces informations à tout moment dans Paramètres.</p>}
      </form>
    </div>
  );
}
