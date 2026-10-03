import type { Metadata } from "next";
import Link from "next/link";
import { VerifyButton } from "./verify-button";

export const metadata: Metadata = { title: "Confirmer l'adresse e-mail" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return <p className="text-sm text-muted-foreground">Lien invalide. <Link href="/connexion" className="text-brand hover:underline">Connexion</Link></p>;
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Confirmer votre adresse e-mail</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Un dernier clic pour activer votre compte.</p>
      <div className="mt-6"><VerifyButton token={token} /></div>
    </>
  );
}
