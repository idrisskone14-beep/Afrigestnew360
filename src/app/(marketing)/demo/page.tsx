import type { Metadata } from "next";
import { Check } from "lucide-react";
import { DemoForm } from "@/components/marketing/demo-form";
import { Section } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Demander une démo",
  description: "Demandez une démonstration personnalisée d'AfriGest 360 : un conseiller configure un environnement adapté à votre activité.",
  alternates: { canonical: "/demo" },
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ offre?: string }> }) {
  const { offre } = await searchParams;
  const plan = offre && /^[a-z0-9-]{2,30}$/.test(offre) ? offre : undefined;
  return (
    <Section className="py-12 sm:py-16">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand">Démonstration</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Voyez AfriGest 360 sur vos propres cas d'usage</h1>
          <p className="mt-4 text-lg text-muted-foreground">En 30 minutes, un conseiller vous montre comment centraliser vos finances, ventes, stocks, RH et projets.</p>
          <ul className="mt-6 space-y-3 text-sm">
            {["Environnement adapté à votre secteur", "Réponse sous 24 h ouvrées", "Sans engagement", "Vos données ne sont jamais partagées"].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />{t}</li>)}
          </ul>
        </div>
        <DemoForm source={plan ? "tarifs" : "demo"} plan={plan} />
      </div>
    </Section>
  );
}
