import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/core/auth/session";
import { getSignupMode } from "@/core/platform-settings";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Inscription" };

export default async function RegisterPage() {
  if (await getCurrentSession()) redirect("/app");
  const mode = await getSignupMode();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Créer votre compte</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{mode === "approval" ? "Votre inscription sera validée par l'administrateur de la plateforme avant votre première connexion." : "Vous créerez ou rejoindrez ensuite une entreprise."}</p>
      <div className="mt-6">
        <RegisterForm mode={mode} />
      </div>
    </>
  );
}
