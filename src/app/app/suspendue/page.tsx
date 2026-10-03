import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/core/auth/actions";
import { loadContextState } from "@/core/tenant/context";

export const metadata: Metadata = { title: "Entreprise suspendue" };

export default async function SuspendedPage() {
  const state = await loadContextState();
  if (state.status === "unauthenticated") redirect("/connexion");
  if (state.status === "ok") redirect("/app/dashboard");
  if (state.status === "no_company") redirect("/app/onboarding");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <PauseCircle className="size-12 text-warning" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Entreprise suspendue</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        L'accès à <strong>{state.companyName}</strong> est temporairement suspendu. Contactez le support AfriGest 360 ou votre administrateur pour le rétablir.
      </p>
      <form action={logoutAction} className="mt-6"><Button variant="outline" type="submit">Se déconnecter</Button></form>
    </main>
  );
}
