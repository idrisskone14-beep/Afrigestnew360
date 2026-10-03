"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { forgotPasswordAction } from "@/core/auth/actions";
import { forgotPasswordSchema } from "@/core/auth/schemas";

type Values = z.input<typeof forgotPasswordSchema>;

export function ForgotForm() {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema) });

  if (done) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Si un compte correspond à cette adresse, un e-mail de réinitialisation vient d'être envoyé (valable 1 heure).
        <Link href="/connexion" className="mt-4 block text-brand hover:underline">Retour à la connexion</Link>
      </div>
    );
  }
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={handleSubmit((v) =>
        start(async () => {
          setFormError(null);
          const res = await forgotPasswordAction(v);
          if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
          setDone(true);
        }),
      )}
    >
      <FormAlert message={formError} />
      <Field label="Adresse e-mail" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus {...register("email")} />
      </Field>
      <SubmitButton pending={pending}>Envoyer le lien</SubmitButton>
      <Link href="/connexion" className="text-center text-sm text-muted-foreground hover:text-foreground">Retour à la connexion</Link>
    </form>
  );
}
