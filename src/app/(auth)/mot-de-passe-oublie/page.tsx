import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Mot de passe oublié</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Nous vous enverrons un lien pour en choisir un nouveau.</p>
      <div className="mt-6"><ForgotForm /></div>
    </>
  );
}
