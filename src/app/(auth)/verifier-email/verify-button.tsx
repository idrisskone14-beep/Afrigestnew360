"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/app/form-kit";
import { verifyEmailAction } from "@/core/auth/actions";

/** Bouton explicite (et non GET automatique) : les scanners d'e-mails ne consomment pas le jeton. */
export function VerifyButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirm = () =>
    start(async () => {
      const res = await verifyEmailAction({ token });
      if (!res.ok) return setError(res.error.message);
      router.push("/connexion?verified=1");
    });

  return (
    <div className="grid gap-4">
      <FormAlert message={error} />
      <Button onClick={confirm} disabled={pending} className="w-full">
        {pending && <Loader2 className="size-4 animate-spin" />}
        Confirmer mon adresse
      </Button>
    </div>
  );
}
