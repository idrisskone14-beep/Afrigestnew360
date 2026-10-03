import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <p className="text-sm text-muted-foreground">
        Lien invalide. <Link href="/mot-de-passe-oublie" className="text-brand hover:underline">Demander un nouveau lien</Link>
      </p>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Nouveau mot de passe</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Toutes vos sessions actives seront fermées.</p>
      <div className="mt-6"><ResetForm token={token} /></div>
    </>
  );
}
