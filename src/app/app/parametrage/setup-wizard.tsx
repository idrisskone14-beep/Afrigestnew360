"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Controller, useForm, useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import {
  setupFiscalSchema, setupIdentificationSchema, setupSocialSchema,
  type SetupFiscalInput, type SetupIdentificationInput, type SetupSocialInput,
} from "@/core/tenant/setup-schemas";
import { ACCOUNTING_FRAMEWORKS, COUNTRIES, SECTORS, TAX_REGIMES, VAT_FREQUENCIES, taxIdLabel } from "@/lib/reference-data";
import {
  completeSetupAction, saveSetupFiscalAction, saveSetupIdentificationAction, saveSetupSocialAction, skipSetupAction,
} from "@/modules/settings/setup-actions";

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

type StepKey = "identification" | "fiscal" | "social" | "team";
const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "identification", label: "Identification", hint: "Qui est l'entreprise" },
  { key: "fiscal", label: "Dossier fiscal", hint: "Impôts et exercice" },
  { key: "social", label: "Dossier social", hint: "Caisse et cotisations" },
  { key: "team", label: "Équipe", hint: "Inviter vos collaborateurs" },
];

export interface SetupInitial { identification: SetupIdentificationInput; fiscal: SetupFiscalInput; social: SetupSocialInput }

export function SetupWizard({ initial, completed, team }: { initial: SetupInitial; completed: boolean; team: ReactNode | null }) {
  const router = useRouter();
  const steps = team ? STEPS : STEPS.filter((s) => s.key !== "team");
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState<Set<StepKey>>(() => new Set());
  const [pending, start] = useTransition();
  const step = steps[index]!;
  const last = index === steps.length - 1;

  const next = () => setIndex((i) => Math.min(i + 1, steps.length - 1));
  const markSaved = (k: StepKey) => { setSaved((s) => new Set(s).add(k)); next(); };

  const leave = (action: "skip" | "complete") =>
    start(async () => {
      const res = await (action === "skip" ? skipSetupAction({}) : completeSetupAction({}));
      if (!res.ok) return void toast.error(res.error.message);
      if (action === "complete") toast.success("Paramétrage terminé. Bienvenue !");
      router.push("/app/dashboard");
      router.refresh();
    });

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{completed ? "Dossier de l'entreprise" : "Paramétrons votre entreprise"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {completed
              ? "Ces informations figurent sur vos documents et alimentent la comptabilité et la paie."
              : "Quelques minutes suffisent. Chaque étape s'enregistre séparément : vous pouvez en passer une et y revenir plus tard dans Paramètres."}
          </p>
        </div>
        {!completed && <Button variant="outline" disabled={pending} onClick={() => leave("skip")}>Passer pour l'instant</Button>}
      </header>

      <nav aria-label="Étapes" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => {
          const done = completed || saved.has(s.key);
          const current = i === index;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${current ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"}`}
            >
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-success text-white" : current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {done ? <Check className="size-4" aria-hidden="true" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{s.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {step.key === "identification" && <IdentificationStep initial={initial.identification} onSaved={() => markSaved("identification")} onSkip={next} />}
      {step.key === "fiscal" && <FiscalStep initial={initial.fiscal} country={initial.identification.country} onSaved={() => markSaved("fiscal")} onSkip={next} />}
      {step.key === "social" && <SocialStep initial={initial.social} onSaved={() => markSaved("social")} onSkip={next} />}
      {step.key === "team" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Équipe</CardTitle>
            <CardDescription>Invitez vos collaborateurs avec leur adresse e-mail et leur rôle : chacun reçoit un lien pour activer son compte. Vous pourrez les gérer ensuite dans Paramètres › Utilisateurs.</CardDescription>
          </CardHeader>
          <CardContent>{team}</CardContent>
        </Card>
      )}

      {last && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{completed ? "Le paramétrage est terminé. Vous pouvez revenir ici à tout moment." : "Vous avez fait le tour. Vous pourrez compléter ce qui manque plus tard."}</p>
          <Button disabled={pending} onClick={() => (completed ? router.push("/app/dashboard") : leave("complete"))}>
            {completed ? "Retour au tableau de bord" : "Terminer le paramétrage"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Liste déroulante liée au formulaire (valeur texte libre : les anciennes valeurs hors liste restent affichées). */
function PickField<T extends FieldValues>({ control, name, items, placeholder }: { control: Control<T>; name: Path<T>; items: readonly string[]; placeholder?: string }) {
  return (
    <Controller control={control} name={name} render={({ field }) => {
      const value = String(field.value ?? "");
      const options = value && !items.includes(value) ? [value, ...items] : items;
      return (
        <Select value={value || undefined} onValueChange={field.onChange}>
          <SelectTrigger className="w-full"><SelectValue placeholder={placeholder ?? "Choisir…"} /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    }} />
  );
}

function StepFooter({ pending, onSkip, label = "Enregistrer et continuer" }: { pending: boolean; onSkip: () => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SubmitButton pending={pending}>{label}</SubmitButton>
      <Button type="button" variant="ghost" onClick={onSkip}>Passer cette étape</Button>
    </div>
  );
}

function IdentificationStep({ initial, onSaved, onSkip }: { initial: SetupIdentificationInput; onSaved: () => void; onSkip: () => void }) {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<SetupIdentificationInput>({ resolver: zodResolver(setupIdentificationSchema), defaultValues: initial });
  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit((v) => start(async () => {
      setFormError(null);
      const res = await saveSetupIdentificationAction(v);
      if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
      toast.success("Identification enregistrée");
      onSaved();
    }))}>
      <FormAlert message={formError} />
      <Card>
        <CardHeader><CardTitle className="text-base">Identification</CardTitle><CardDescription>Ces informations figurent sur vos devis, factures et bulletins.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Raison sociale" htmlFor="su-legalName" error={errors.legalName?.message}><Input id="su-legalName" {...register("legalName")} /></Field>
          <Field label="Nom commercial" htmlFor="su-tradeName" error={errors.tradeName?.message}><Input id="su-tradeName" {...register("tradeName")} /></Field>
          <Field label="Sigle usuel" htmlFor="su-acronym" error={errors.acronym?.message}><Input id="su-acronym" {...register("acronym")} /></Field>
          <Field label="Forme juridique" htmlFor="su-legalForm" error={errors.legalForm?.message}><Input id="su-legalForm" placeholder="SARL, SA, SAS, entreprise individuelle…" {...register("legalForm")} /></Field>
          <Field label="Capital social" htmlFor="su-shareCapital" hint="Laisser vide pour ne pas l'afficher" error={errors.shareCapital?.message}><Input id="su-shareCapital" type="number" min={0} {...register("shareCapital")} /></Field>
          <Field label="RCCM" htmlFor="su-rccm" error={errors.rccm?.message}><Input id="su-rccm" {...register("rccm")} /></Field>
          <Field label="Secteur d'activité" error={errors.sector?.message}><PickField control={control} name="sector" items={SECTORS} /></Field>
          <Field label="Activité de l'entreprise" htmlFor="su-activity" error={errors.activityDescription?.message}><Input id="su-activity" placeholder="Ex. Transports routiers de marchandises" {...register("activityDescription")} /></Field>
          <Field label="Référentiel comptable" hint="SYSCOHADA révisé dans les pays de l'OHADA" error={errors.accountingFramework?.message}><PickField control={control} name="accountingFramework" items={ACCOUNTING_FRAMEWORKS} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Coordonnées</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Pays" error={errors.country?.message}>
            <Controller control={control} name="country" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Adresse" htmlFor="su-address" error={errors.address?.message}><Input id="su-address" {...register("address")} /></Field>
          <Field label="Commune" htmlFor="su-commune" error={errors.commune?.message}><Input id="su-commune" {...register("commune")} /></Field>
          <Field label="Ville" htmlFor="su-city" error={errors.city?.message}><Input id="su-city" {...register("city")} /></Field>
          <Field label="Code postal" htmlFor="su-postal" error={errors.postalCode?.message}><Input id="su-postal" {...register("postalCode")} /></Field>
          <Field label="Téléphone" htmlFor="su-phone" error={errors.phone?.message}><Input id="su-phone" {...register("phone")} /></Field>
          <Field label="E-mail de l'entreprise" htmlFor="su-email" className="sm:col-span-2" error={errors.email?.message}><Input id="su-email" type="email" {...register("email")} /></Field>
        </CardContent>
      </Card>
      <StepFooter pending={pending} onSkip={onSkip} />
    </form>
  );
}

function FiscalStep({ initial, country, onSaved, onSkip }: { initial: SetupFiscalInput; country: string; onSaved: () => void; onSkip: () => void }) {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<SetupFiscalInput>({ resolver: zodResolver(setupFiscalSchema), defaultValues: initial });
  const vat = useWatch({ control, name: "vatFrequency" });
  const idLabel = taxIdLabel(country);
  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit((v) => start(async () => {
      setFormError(null);
      const res = await saveSetupFiscalAction(v);
      if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
      toast.success("Dossier fiscal enregistré");
      onSaved();
    }))}>
      <FormAlert message={formError} />
      <Card>
        <CardHeader><CardTitle className="text-base">Dossier fiscal</CardTitle><CardDescription>Tout est facultatif : renseignez ce que vous avez sous la main.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Régime fiscal" error={errors.taxRegime?.message}><PickField control={control} name="taxRegime" items={TAX_REGIMES} /></Field>
          <Field label="Date de début d'activité" htmlFor="su-start" error={errors.activityStartDate?.message}><Input id="su-start" type="date" {...register("activityStartDate")} /></Field>
          <Field label={`Identifiant fiscal${idLabel === "ID fiscal" ? "" : ` (${idLabel})`}`} htmlFor="su-taxId" error={errors.taxId?.message}><Input id="su-taxId" {...register("taxId")} /></Field>
          <Field label="Numéro de télé-déclarant (NTD)" htmlFor="su-ntd" error={errors.ntd?.message}><Input id="su-ntd" {...register("ntd")} /></Field>
          <Field label="Fréquence de déclaration de TVA" error={errors.vatFrequency?.message}><PickField control={control} name="vatFrequency" items={VAT_FREQUENCIES} /></Field>
          {vat !== "Non assujetti à la TVA" && (
            <Field label="ROF TVA" htmlFor="su-rof" error={errors.vatRof?.message}><Input id="su-rof" {...register("vatRof")} /></Field>
          )}
          <Field label="Numéro de TVA intracommunautaire" htmlFor="su-intra" error={errors.intraCommunityVat?.message}><Input id="su-intra" {...register("intraCommunityVat")} /></Field>
          <Field label="Direction régionale des impôts" htmlFor="su-region" error={errors.taxRegion?.message}><Input id="su-region" {...register("taxRegion")} /></Field>
          <Field label="Service des impôts" htmlFor="su-office" error={errors.taxOffice?.message}><Input id="su-office" {...register("taxOffice")} /></Field>
          <Field label="Début de l'exercice comptable" error={errors.fiscalYearStartMonth?.message}>
            <Controller control={control} name="fiscalYearStartMonth" render={({ field }) => (
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
        </CardContent>
      </Card>
      <StepFooter pending={pending} onSkip={onSkip} />
    </form>
  );
}

function SocialStep({ initial, onSaved, onSkip }: { initial: SetupSocialInput; onSaved: () => void; onSkip: () => void }) {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<SetupSocialInput>({ resolver: zodResolver(setupSocialSchema), defaultValues: initial });
  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit((v) => start(async () => {
      setFormError(null);
      const res = await saveSetupSocialAction(v);
      if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
      toast.success("Dossier social enregistré");
      onSaved();
    }))}>
      <FormAlert message={formError} />
      <Card>
        <CardHeader><CardTitle className="text-base">Dossier social</CardTitle><CardDescription>Caisse de sécurité sociale et taux de cotisation de l'employeur. Facultatif tant que vous n'établissez pas de paie.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Numéro de la caisse sociale" htmlFor="su-cnps" error={errors.socialSecurityNumber?.message}><Input id="su-cnps" {...register("socialSecurityNumber")} /></Field>
          <Field label="Secteur de salaires minima catégoriels" htmlFor="su-minwage" error={errors.minimumWageSector?.message}><Input id="su-minwage" {...register("minimumWageSector")} /></Field>
          <Field label="Taux de prestation familiale (%)" htmlFor="su-family" error={errors.familyBenefitRate?.message}><Input id="su-family" type="number" step="0.01" min={0} max={100} {...register("familyBenefitRate")} /></Field>
          <Field label="Taux d'accident du travail (%)" htmlFor="su-accident" error={errors.workAccidentRate?.message}><Input id="su-accident" type="number" step="0.01" min={0} max={100} {...register("workAccidentRate")} /></Field>
        </CardContent>
      </Card>
      <StepFooter pending={pending} onSkip={onSkip} />
    </form>
  );
}
