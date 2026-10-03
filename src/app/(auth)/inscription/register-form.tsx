"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import type { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { registerAction } from "@/core/auth/actions";
import { registerSchema } from "@/core/auth/schemas";

type Values = z.input<typeof registerSchema>;

export function RegisterForm() {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "", acceptTerms: false as unknown as true },
  });

  const onSubmit = (values: Values) =>
    start(async () => {
      setFormError(null);
      const res = await registerAction(values);
      if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
      setSentTo(res.data.email);
    });

  if (sentTo) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <MailCheck className="mx-auto size-10 text-brand-green" />
        <h2 className="mt-3 text-lg font-semibold">Vérifiez votre boîte mail</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Si l'adresse <strong>{sentTo}</strong> est valide, un lien de confirmation vient de vous être envoyé.
        </p>
        <Link href="/connexion" className="mt-5 inline-block text-sm text-brand hover:underline">Aller à la connexion</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <FormAlert message={formError} />
      <Field label="Nom complet" htmlFor="name" error={errors.name?.message}>
        <Input id="name" autoComplete="name" autoFocus {...register("name")} />
      </Field>
      <Field label="Adresse e-mail" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
      </Field>
      <Field label="Mot de passe" htmlFor="password" hint="10 caractères min., avec majuscule, minuscule et chiffre." error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </Field>
      <Field label="Confirmer le mot de passe" htmlFor="confirmPassword" error={errors.confirmPassword?.message}>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
      </Field>
      <div className="grid gap-1.5">
        <label className="flex items-start gap-2.5 text-sm">
          <Controller
            control={control}
            name="acceptTerms"
            render={({ field }) => (
              <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />
            )}
          />
          <span className="text-muted-foreground">J'accepte les conditions d'utilisation et la politique de confidentialité.</span>
        </label>
        {errors.acceptTerms && <p role="alert" className="text-xs text-destructive">{errors.acceptTerms.message}</p>}
      </div>
      <SubmitButton pending={pending} className="w-full">Créer mon compte</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        Déjà inscrit ? <Link href="/connexion" className="text-brand hover:underline">Se connecter</Link>
      </p>
    </form>
  );
}
