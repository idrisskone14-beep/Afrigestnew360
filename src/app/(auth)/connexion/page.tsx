import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/core/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; verified?: string }> }) {
  const sp = await searchParams;
  if (await getCurrentSession()) redirect("/app");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Accédez à votre espace AfriGest 360.</p>
      {sp.reset && <p className="mt-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">Mot de passe modifié. Connectez-vous.</p>}
      {sp.verified && <p className="mt-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">Adresse e-mail confirmée. Vous pouvez vous connecter.</p>}
      <div className="mt-6">
        <LoginForm next={sp.next} />
      </div>
    </>
  );
}
