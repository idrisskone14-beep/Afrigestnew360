import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { loadContextState } from "@/core/tenant/context";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Créer votre entreprise" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const state = await loadContextState();
  if (state.status === "unauthenticated") redirect("/connexion");
  const isFirst = state.status === "no_company";
  if (state.status === "ok" && !sp.new) redirect("/app/dashboard");
  // le propriétaire de la plateforme sans entreprise arrive directement dans sa console
  if (state.status === "no_company" && state.user.isPlatformAdmin && !sp.new) redirect("/super-admin");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5 py-10">
      <Logo className="mb-8" />
      <h1 className="text-2xl font-semibold tracking-tight">{isFirst ? "Bienvenue ! Créons votre entreprise" : "Nouvelle entreprise"}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Quelques informations suffisent pour démarrer ; vous compléterez le reste dans Paramètres. Vous serez administrateur de cette entreprise.
      </p>
      <div className="mt-6 rounded-xl border bg-card p-5 sm:p-6">
        <OnboardingForm defaultName={state.status === "no_company" ? state.user.name : state.status === "ok" ? state.ctx.user.name : ""} isFirst={isFirst} />
      </div>
    </main>
  );
}
