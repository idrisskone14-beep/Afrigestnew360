import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/core/auth/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Inscription" };

export default async function RegisterPage() {
  if (await getCurrentSession()) redirect("/app");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Créer votre compte</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Vous créerez ou rejoindrez ensuite une entreprise.</p>
      <div className="mt-6">
        <RegisterForm />
      </div>
    </>
  );
}
