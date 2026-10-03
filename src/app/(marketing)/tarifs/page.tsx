import type { Metadata } from "next";
import Link from "next/link";
import { PricingTable } from "@/components/marketing/pricing-table";
import { PageIntro, Section } from "@/components/marketing/section";
import { FAQ } from "@/components/marketing/content";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { getPublicPlans } from "@/modules/platform/demo";

export const metadata: Metadata = {
  title: "Tarifs",
  description: "Offres Starter, Business et Enterprise : modules inclus, limites et prix en FCFA. Essai gratuit.",
  alternates: { canonical: "/tarifs" },
};

export default async function PricingPage() {
  const plans = await getPublicPlans();
  return (
    <>
      <PageIntro eyebrow="Tarifs" title="Des offres claires, en FCFA" description="Essai gratuit inclus, sans engagement. Les prix sont indiqués hors taxes." />
      <Section>
        {plans.length ? <PricingTable plans={plans} /> : <p className="text-center text-muted-foreground">Nos offres seront bientôt publiées. <Link href="/demo" className="text-brand hover:underline">Contactez-nous</Link>.</p>}
        <p className="mt-8 text-center text-sm text-muted-foreground">Besoin d'un volume ou de modules spécifiques ? <Link href="/contact" className="text-brand hover:underline">Demandez un devis sur mesure</Link>.</p>
      </Section>
      <Section tone="muted" eyebrow="FAQ" title="Questions sur les offres">
        <Accordion type="single" collapsible className="mx-auto max-w-3xl rounded-xl border bg-card px-5">
          {FAQ.slice(0, 5).map((f, i) => (
            <AccordionItem key={f.q} value={`q${i}`}>
              <AccordionTrigger className="text-left text-base">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>
    </>
  );
}
