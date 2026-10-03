import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { ModuleIcon } from "@/components/app/icons";
import { FEATURE_GROUPS } from "@/components/marketing/content";
import { PageIntro, Section } from "@/components/marketing/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MODULE_BY_KEY } from "@/core/modules/registry";

export const metadata: Metadata = {
  title: "Fonctionnalités",
  description: "Finance, comptabilité SYSCOHADA, ventes et facturation, CRM, achats, stocks, RH, paie, projets, GED, reporting, transport et chantiers : toutes les fonctionnalités d'AfriGest 360.",
  alternates: { canonical: "/fonctionnalites" },
};

const FOUNDATIONS = [
  "Comptes, connexion sécurisée, 2FA, sessions révocables",
  "Plusieurs entreprises par compte, Company Switcher",
  "Rôles et permissions personnalisables par entreprise",
  "Offres, modules et limites d'usage",
  "Journal d'audit, notifications, palette de commandes",
  "Console d'administration de la plateforme",
];

export default function FeaturesPage() {
  return (
    <>
      <PageIntro eyebrow="Fonctionnalités" title="Un seul outil pour toute votre gestion" description="Chaque module partage les mêmes données : vous ne ressaisissez jamais une information." />

      <Section>
        <div className="mb-10 rounded-2xl border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-semibold">Fondations</h2><Badge className="bg-success/15 text-success hover:bg-success/15">Disponible</Badge></div>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {FOUNDATIONS.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />{f}</li>)}
          </ul>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {FEATURE_GROUPS.map((g) => {
            const m = MODULE_BY_KEY.get(g.module);
            return (
              <article key={g.module} id={g.module} className="rounded-2xl border bg-card p-6 sm:p-7">
                <header className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"><ModuleIcon name={m?.icon} className="size-5" /></span>
                  <h2 className="text-lg font-semibold">{g.title}</h2>
                  <span className="ml-auto flex gap-1.5">
                    {m?.kind === "EXTENSION" && <Badge variant="outline">Extension</Badge>}
                    <Badge variant={m?.status === "available" ? "default" : "secondary"}>{m?.status === "available" ? "Disponible" : "Bientôt"}</Badge>
                  </span>
                </header>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {g.bullets.map((b) => <li key={b} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />{b}</li>)}
                </ul>
              </article>
            );
          })}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">« Bientôt » : l'architecture, les permissions et l'activation par offre sont en place ; les écrans sont livrés module par module. Demandez-nous le calendrier.</p>
        <div className="mt-8 text-center"><Button size="lg" asChild><Link href="/demo">Demander une démo</Link></Button></div>
      </Section>
    </>
  );
}
