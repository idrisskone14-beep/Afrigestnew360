"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Erreur inattendue : aucun détail technique n'est affiché ; seule la référence (digest) l'est. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Une erreur est survenue</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nous n'avons pas pu afficher cette page.{error.digest ? ` Référence : ${error.digest}.` : ""}
      </p>
      <Button onClick={reset} className="mt-6">Réessayer</Button>
    </div>
  );
}
