import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Briefcase, Building2, Camera, Check, Fingerprint, HardHat, KeyRound, Layers, LockKeyhole, PlusCircle, ScanLine, ScrollText, ShieldCheck, Smartphone, Store, Truck,
} from "lucide-react";
import { ModuleIcon } from "@/components/app/icons";
import { DesktopShot, PhoneShot } from "@/components/marketing/browser-frame";
import { DemoForm } from "@/components/marketing/demo-form";
import { FlowShowcase } from "@/components/marketing/flow-showcase";
import { PricingTable } from "@/components/marketing/pricing-table";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { FAQ, FIELD_ACTIONS, FLOW, HERO_CHIPS, IMPORT_ITEMS, SECURITY_POINTS, TRADES } from "@/components/marketing/content";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MODULES } from "@/core/modules/registry";
import { getPublicPlans } from "@/modules/platform/demo";

export const metadata: Metadata = {
  title: { absolute: "Global Gest — Du devis à la comptabilité, sans ressaisir une seule ligne" },
  description: "Devis, factures, paiements, stock, comptabilité SYSCOHADA et RH dans un seul outil, en FCFA, sur ordinateur comme sur téléphone. Global Gest, la gestion d'entreprise pensée pour l'Afrique.",
  alternates: { canonical: "/" },
};

const SECURITY_ICONS = [Building2, KeyRound, Fingerprint, ScrollText, Layers, LockKeyhole];
const FIELD_ICONS = { ScanLine, Camera, PlusCircle, Smartphone };
const TRADE_ICONS = { Store, HardHat, Truck, Briefcase };

/** Quadrillage de la marque (le même motif que sur le logo), estompé vers les bords. */
const GRID =
  "[background-image:linear-gradient(to_right,rgb(0_208_152/0.11)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_208_152/0.11)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_70%_35%,#000_15%,transparent_72%)]";

export default async function LandingPage() {
  const plans = await getPublicPlans();
  const modules = MODULES.filter((m) => m.kind !== "CORE");

  return (
    <>
      {/* Héros : un résultat concret, et le vrai produit */}
      <section className="relative overflow-hidden bg-navy text-white">
        <div className={"pointer-events-none absolute inset-0 " + GRID} aria-hidden />
        <div className="accent-line relative" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[0.9fr_1.2fr] lg:gap-10 lg:px-8 lg:pb-28">
          <Reveal>
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-2">Gestion commerciale, stock, comptabilité et RH · en FCFA</p>
            <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              Du devis à la comptabilité, <span className="italic text-brand-2">sans ressaisir une seule ligne.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/75">
              Global Gest relie vos devis, factures, paiements, stocks et écritures comptables. En FCFA, avec un plan comptable SYSCOHADA, sur ordinateur comme sur téléphone.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" className="h-12 bg-brand-2 px-7 text-base text-brand-2-foreground hover:bg-brand-2/90" asChild><Link href="/demo">Demander une démo <ArrowRight className="size-4" /></Link></Button>
              <Button size="lg" variant="outline" className="h-12 border-white/30 bg-transparent px-7 text-base text-white hover:bg-white/10 hover:text-white" asChild><Link href="#parcours">Voir comment ça marche</Link></Button>
            </div>
            <ul className="mt-8 grid max-w-xl gap-x-6 gap-y-2 text-sm text-white/70 sm:grid-cols-2">
              {HERO_CHIPS.map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-4 shrink-0 text-brand-2" aria-hidden="true" />{t}</li>)}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <DesktopShot src="/landing/hero.webp" alt="Les encaissements dans Global Gest : paiements en espèces, Mobile Money, virement et chèque, avec leur reçu" priority className="border-white/10 shadow-2xl" />
          </Reveal>
        </div>
      </section>

      {/* Le flux : du devis à l'écriture comptable */}
      <Section id="parcours" eyebrow="Un seul flux" title="Saisissez une fois, retrouvez partout" description="Chaque étape alimente la suivante : le devis devient une facture, la facture un encaissement, l'encaissement une écriture comptable.">
        <FlowShowcase steps={FLOW} />
      </Section>

      {/* Mobile : le terrain */}
      <Section tone="muted" eyebrow="Sur le terrain" title="Au dépôt, sur le chantier, en tournée : tout se fait depuis le téléphone">
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELD_ACTIONS.map((a, i) => {
              const Icon = FIELD_ICONS[a.icon];
              return (
                <Reveal key={a.title} delay={i * 0.05}>
                  <div className="h-full rounded-xl border bg-card p-6">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-5" aria-hidden="true" /></span>
                    <h3 className="mt-4 font-semibold">{a.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{a.text}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
          <Reveal delay={0.1}><PhoneShot src="/landing/mobile.webp" alt="Global Gest sur un téléphone : tableau de bord et barre de navigation du bas" /></Reveal>
        </div>
      </Section>

      {/* Les métiers */}
      <Section id="metiers" eyebrow="Pour votre métier" title="Des outils qui parlent votre métier" description="Commerce, chantiers, transport, services : les fonctions dont vous avez réellement besoin, déjà dans l'outil.">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRADES.map((t, i) => {
            const Icon = TRADE_ICONS[t.icon];
            return (
              <Reveal key={t.key} delay={i * 0.05}>
                <div className="flex h-full flex-col rounded-xl border bg-card p-6">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-5" aria-hidden="true" /></span>
                  <h3 className="mt-4 flex flex-wrap items-center gap-2 font-semibold">{t.title}{t.extension && <Badge variant="outline">Extension</Badge>}</h3>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {t.points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />{p}</li>)}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-8 text-center text-sm"><Link href="/solutions" className="text-brand hover:underline">Voir les solutions par fonction →</Link></p>
      </Section>

      {/* Reprise des données */}
      <section className="pb-4 sm:pb-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-5xl items-center gap-8 rounded-2xl border bg-card p-8 sm:p-10 md:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="eyebrow">Reprise de vos données</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Vous venez d'Excel ? Ne repartez pas de zéro.</h2>
              <p className="mt-3 text-muted-foreground">Importez vos fichiers Excel ou CSV à partir de nos modèles. Un rapport d'anomalies vous indique, ligne par ligne, ce qu'il faut corriger.</p>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Données importables">
              {IMPORT_ITEMS.map((t) => <li key={t} className="rounded-full border bg-secondary px-3.5 py-1.5 text-sm font-medium">{t}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* 6. Modules */}
      <Section id="modules" eyebrow="Modules" title="Activez seulement ce dont vous avez besoin" description="Chaque offre inclut les modules utiles à votre activité ; les extensions Transport et Chantiers se greffent sans changer d'outil.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, i) => (
            <Reveal key={m.key} delay={(i % 3) * 0.05}>
              <Link href="/fonctionnalites" className="group flex h-full gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-brand/50">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><ModuleIcon name={m.icon} className="size-5" /></span>
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-semibold">{m.name}{m.kind === "EXTENSION" && <Badge variant="outline">Extension</Badge>}{m.status === "planned" && <Badge variant="secondary">Bientôt</Badge>}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{m.description}</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">Tous ces modules sont disponibles dès aujourd'hui, selon votre offre, à l'exception de Global Gest Intelligence (bientôt) — <Link href="/fonctionnalites" className="text-brand hover:underline">voir le détail</Link>.</p>
      </Section>

      {/* 10. Sécurité */}
      <Section id="securite" eyebrow="Sécurité" title="Vos données ne sont jamais mélangées" description="La sécurité n'est pas une option : elle est dans l'architecture.">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY_POINTS.map((p, i) => {
            const Icon = SECURITY_ICONS[i] ?? ShieldCheck;
            return (
              <Reveal key={p.title} delay={(i % 3) * 0.05}>
                <div className="h-full rounded-xl border bg-card p-6">
                  <Icon className="size-6 text-brand" />
                  <h3 className="mt-3 font-semibold">{p.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{p.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* 11. Multi-entreprises */}
      <Section tone="muted" eyebrow="Multi-entreprises" title="Un compte, plusieurs entreprises, des droits distincts">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="space-y-4 text-muted-foreground">
            <p>Vous dirigez une société, conseillez une autre et consultez une troisième ? Basculez de l'une à l'autre en un clic : le tableau de bord, les permissions, les modules et les données changent immédiatement — et en toute sécurité.</p>
            <ul className="space-y-2 text-sm">
              {["Entreprise A — Administrateur", "Entreprise B — Responsable commercial", "Entreprise C — Consultation uniquement"].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-blue" />{t}</li>)}
            </ul>
            <p className="text-sm">Chaque entreprise garde ses propres utilisateurs, rôles, clients, finances, stocks, documents, paramètres et abonnement. Agences, sites, départements et centres de coûts permettent d'analyser par implantation.</p>
          </div>
          <Reveal>
            <div className="mx-auto w-full max-w-sm rounded-2xl border bg-card p-3 shadow-xl">
              <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground">Vos entreprises</p>
              {[{ n: "Africa Business Demo", r: "Administrateur", a: true }, { n: "Sahel Transport", r: "Responsable commercial" }, { n: "Batimat", r: "Consultation" }].map((c) => (
                <div key={c.n} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${c.a ? "bg-accent" : ""}`}>
                  <span className="flex size-8 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">{c.n.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{c.n}</span><span className="block text-xs text-muted-foreground">{c.r}</span></span>
                  {c.a && <Check className="size-4 text-brand" />}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>

      {/* 13. Tarifs */}
      <Section id="tarifs" tone="muted" eyebrow="Tarifs" title="Des offres simples, qui évoluent avec vous" description="Essai gratuit inclus. Passez d'une offre à l'autre à tout moment.">
        <PricingTable plans={plans} />
        <p className="mt-8 text-center text-sm text-muted-foreground">Besoin d'un devis sur mesure ? <Link href="/contact" className="text-brand hover:underline">Contactez-nous</Link></p>
      </Section>

      {/* 15. FAQ */}
      <Section id="faq" tone="muted" eyebrow="FAQ" title="Questions fréquentes">
        <Accordion type="single" collapsible className="mx-auto max-w-3xl rounded-xl border bg-card px-5">
          {FAQ.map((f, i) => (
            <AccordionItem key={f.q} value={`q${i}`}>
              <AccordionTrigger className="text-left text-base">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      {/* 16. CTA final */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Et si votre prochain devis passait en comptabilité tout seul ?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/70">Un conseiller configure avec vous un environnement adapté à votre activité.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="secondary" asChild><Link href="#demo">Demander une démo</Link></Button>
            <Button size="lg" variant="outline" asChild className="border-primary-foreground/30 bg-primary text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"><Link href="/inscription">Créer un compte</Link></Button>
          </div>
        </div>
      </section>

      {/* 17. Formulaire de démonstration */}
      <Section id="demo" eyebrow="Démonstration" title="Demandez votre démonstration" description="Réponse sous 24 h ouvrées. Aucun engagement.">
        <div className="mx-auto max-w-2xl"><DemoForm /></div>
      </Section>
    </>
  );
}
