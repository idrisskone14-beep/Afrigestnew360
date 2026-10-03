import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { PageIntro, Section } from "@/components/marketing/section";
import { SECTORS_LIST, SOLUTIONS } from "@/components/marketing/content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MODULE_BY_KEY } from "@/core/modules/registry";

export const metadata: Metadata = {
  title: "Solutions",
  description: "AfriGest 360 pour les dirigeants, la finance, le commercial, les achats et la logistique, les RH et la paie, les projets et chantiers.",
  alternates: { canonical: "/solutions" },
};

export default function SolutionsPage() {
  return (
    <>
      <PageIntro eyebrow="Solutions" title="Une réponse pour chaque fonction de l'entreprise" description="Chaque équipe travaille dans son espace, avec ses droits, sur les mêmes données." />
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {SOLUTIONS.map((s) => (
            <article key={s.slug} id={s.slug} className="flex flex-col rounded-2xl border bg-card p-7">
              <h2 className="text-xl font-semibold">{s.title}</h2>
              <p className="mt-1 text-brand">{s.pain}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                {s.points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />{p}</li>)}
              </ul>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {s.modules.map((k) => <Badge key={k} variant="secondary">{MODULE_BY_KEY.get(k)?.name ?? k}</Badge>)}
              </div>
            </article>
          ))}
        </div>
      </Section>
      <Section tone="muted" eyebrow="Par secteur" title="Et selon votre activité">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTORS_LIST.map((s) => (
            <div key={s.title} className="rounded-xl border bg-card p-5"><h3 className="font-semibold">{s.title}</h3><p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p></div>
          ))}
        </div>
        <div className="mt-10 text-center"><Button size="lg" asChild><Link href="/demo">Parler à un conseiller</Link></Button></div>
      </Section>
    </>
  );
}
