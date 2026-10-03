"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, SubmitButton } from "@/components/app/form-kit";
import { acceptInvitationAction } from "@/core/auth/actions";
import { passwordSchema } from "@/core/auth/password-policy";

interface Values { name: string; password: string }

export function InvitationForm({ token, email, userExists, signedInAs }: { token: string; email: string; userExists: boolean; signedInAs: string | null }) {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<Values>({ defaultValues: { name: "", password: "" } });

  const finish = (mustLogin: boolean) => {
    window.location.assign(mustLogin ? "/connexion" : "/app");
  };

  if (userExists) {
    if (signedInAs?.toLowerCase() !== email.toLowerCase()) {
      return (
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Un compte existe pour <strong>{email}</strong>. Connectez-vous avec cette adresse pour accepter l'invitation.</p>
          <Link href={`/connexion?next=${encodeURIComponent(`/invitation/${token}`)}`} className="font-medium text-brand hover:underline">Se connecter</Link>
        </div>
      );
    }
    return (
      <div className="grid gap-4">
        <FormAlert message={formError} />
        <Button
          disabled={pending}
          className="w-full"
          onClick={() =>
            start(async () => {
              const res = await acceptInvitationAction({ token });
              if (!res.ok) return setFormError(res.error.message);
              finish(false);
            })
          }
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Accepter l'invitation
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={handleSubmit((v) => {
        const pw = passwordSchema.safeParse(v.password);
        if (!pw.success) return setError("password", { message: pw.error.issues[0]?.message });
        if (v.name.trim().length < 2) return setError("name", { message: "Nom requis" });
        start(async () => {
          setFormError(null);
          const res = await acceptInvitationAction({ token, name: v.name, password: v.password });
          if (!res.ok) return setFormError(res.error.message);
          finish(res.data.mustLogin);
        });
      })}
    >
      <FormAlert message={formError} />
      <Field label="Nom complet" htmlFor="name" error={errors.name?.message}>
        <Input id="name" autoComplete="name" autoFocus {...register("name")} />
      </Field>
      <Field label="Mot de passe" htmlFor="password" hint="10 caractères min., avec majuscule, minuscule et chiffre." error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </Field>
      <SubmitButton pending={pending}>Créer mon compte et rejoindre</SubmitButton>
    </form>
  );
}
