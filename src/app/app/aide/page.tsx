import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";

export const metadata: Metadata = { title: "Aide" };

export default async function HelpPage() {
  await requireTenantContext();
  return (
    <>
      <PageHeader title="Aide" description="Les essentiels pour prendre en main AfriGest 360." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Raccourcis clavier</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Ctrl / ⌘ + K" v="Ouvrir la palette de commandes" />
            <Row k="Échap" v="Fermer une fenêtre ou la palette" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Comprendre vos accès</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Ce que vous voyez dépend de <strong>l'entreprise active</strong> (sélecteur en haut à gauche), des <strong>modules</strong> inclus dans son offre et des <strong>permissions</strong> de votre rôle.</p>
            <p>Un module ou une action manquante ? Demandez à un administrateur de l'entreprise : <Link href="/app/parametres/roles" className="text-brand hover:underline">Rôles et permissions</Link>, ou <Link href="/app/parametres/abonnement" className="text-brand hover:underline">Abonnement</Link>.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Sécurité</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Activez l'authentification à deux facteurs et surveillez vos appareils connectés dans <Link href="/app/parametres/securite" className="text-brand hover:underline">Sécurité du compte</Link>.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Support</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Écrivez-nous depuis la page <Link href="/contact" className="text-brand hover:underline">Contact</Link>.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{v}</span>
      <kbd className="rounded border bg-muted px-2 py-0.5 font-sans text-xs">{k}</kbd>
    </div>
  );
}
