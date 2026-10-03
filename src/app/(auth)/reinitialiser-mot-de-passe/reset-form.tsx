"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { resetPasswordAction } from "@/core/auth/actions";
import { resetPasswordSchema } from "@/core/auth/schemas";

type Values = z.input<typeof resetPasswordSchema>;

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={handleSubmit((v) =>
        start(async () => {
          setFormError(null);
          const res = await resetPasswordAction(v);
          if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
          router.push("/connexion?reset=1");
        }),
      )}
    >
      <FormAlert message={formError} />
      <Field label="Nouveau mot de passe" htmlFor="password" hint="10 caractères min., avec majuscule, minuscule et chiffre." error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" autoFocus {...register("password")} />
      </Field>
      <Field label="Confirmer" htmlFor="confirmPassword" error={errors.confirmPassword?.message}>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
      </Field>
      <SubmitButton pending={pending}>Enregistrer</SubmitButton>
    </form>
  );
}
