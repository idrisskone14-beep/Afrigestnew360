"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { loginAction } from "@/core/auth/actions";
import { loginSchema } from "@/core/auth/schemas";
import type { z } from "zod";

type Values = z.input<typeof loginSchema>;

export function LoginForm({ next }: { next?: string }) {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", totp: "", next },
  });

  const onSubmit = (values: Values) =>
    start(async () => {
      setFormError(null);
      const res = await loginAction({ ...values, next });
      if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
      if (res.data.twoFactorRequired) {
        setNeedsCode(true);
        return;
      }
      // navigation complète : le cookie de session vient d'être posé
      window.location.assign(res.data.next);
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <FormAlert message={formError} />
      <div className={needsCode ? "hidden" : "grid gap-4"}>
        <Field label="Adresse e-mail" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus {...register("email")} />
        </Field>
        <Field label="Mot de passe" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
        </Field>
      </div>
      {needsCode && (
        <Field label="Code de vérification" htmlFor="totp" hint="Code à 6 chiffres de votre application, ou un code de secours." error={errors.totp?.message}>
          <Input id="totp" inputMode="text" autoComplete="one-time-code" autoFocus {...register("totp")} />
        </Field>
      )}
      <SubmitButton pending={pending} className="w-full">{needsCode ? "Valider" : "Se connecter"}</SubmitButton>
      {needsCode ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => { setNeedsCode(false); setFormError(null); }}>
          Retour
        </Button>
      ) : (
        <div className="flex items-center justify-between text-sm">
          <Link href="/mot-de-passe-oublie" className="text-brand hover:underline">Mot de passe oublié ?</Link>
          <Link href="/inscription" className="text-muted-foreground hover:text-foreground">Créer un compte</Link>
        </div>
      )}
    </form>
  );
}
