import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Building2, Check, Fingerprint, KeyRound, Layers, LockKeyhole, ScrollText, ShieldCheck, Sparkles, XCircle,
} from "lucide-react";
import { ModuleIcon } from "@/components/app/icons";
import { DashboardMockup } from "@/components/marketing/dashboard-mockup";
import { DemoForm } from "@/components/marketing/demo-form";
import { PricingTable } from "@/components/marketing/pricing-table";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import {
  BENEFITS, FAQ, PILLARS, PROBLEMS, SECTORS_LIST, SECURITY_POINTS, STEPS, USE_CASES,
} from "@/components/marketing/content";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MODULES } from "@/core/modules/registry";
import { COUNTRIES } from "@/lib/reference-data";
import { getPublicPlans } from "@/modules/platform/demo";

export const metadata: Metadata = {
  title: { absolute: "AfriGest 360 — Toute votre entreprise. Une seule plateforme." },
  description: "Finances, ventes, clients, employés, stocks, projets et opérations : gérez toute votre entreprise depuis AfriGest 360, la plateforme de gestion pensée pour l'Afrique.",
  alternates: { canonical: "/" },
};

const SECURITY_ICONS = [Building2, KeyRound, Fingerprint, ScrollText, Layers, LockKeyhole];
const CORE_COUNTRIES = COUNTRIES.filter((c) => ["CI", "SN", "ML", "BF", "BJ", "TG", "CM", "GA", "GH", "NG", "MA", "RW"].includes(c.code));

export default async function LandingPage() {
  const plans = await getPublicPlans();
  const modules = MODULES.filter((m) => m.kind !== "CORE");

  return (
    <>
      {/* 2. Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] bg-gradient-to-b from-accent/80 via-background to-background" />
        <div className="pointer-events-none absolute -right-24 -top-24 -z-10 size-[30rem] animate-float rounded-full bg-brand/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-40 -z-10 size-[24rem] animate-float rounded-full bg-brand-green/20 blur-3xl [animation-delay:-3s]" aria-hidden />
        <div className="pointer-events-none absolute left-1/2 top-10 -z-10 size-72 animate-float rounded-full bg-brand-2/15 blur-3xl [animation-delay:-5s]" aria-hidden />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_1.1fr] lg:gap-8 lg:px-8 lg:pb-24">
          <Reveal>
            <Badge variant="secondary" className="mb-5 gap-1.5 border-brand/20 bg-brand/10 px-3 py-1 text-brand"><Sparkles className="size-3.5" /> La plateforme de gestion pensée pour l'Afrique</Badge>
            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.6rem]">Toute votre entreprise. <span className="gradient-brand-text animate-gradient-pan bg-[length:200%_100%]">Une seule plateforme.</span></h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">Gérez vos finances, vos ventes, vos clients, vos employés, vos stocks, vos projets et vos opérations depuis AfriGest 360.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" className="h-12 px-7 text-base" asChild><Link href="/demo">Demander une démo <ArrowRight className="size-4" /></Link></Button>
              <Button size="lg" variant="outline" className="h-12 px-7 text-base" asChild><Link href="#presentation">Découvrir AfriGest 360</Link></Button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["FCFA & multi-devises", "Multi-entreprises", "Données isolées et auditées"].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-brand-green" />{t}</li>)}
            </ul>
          </Reveal>
          <Reveal delay={0.1}><DashboardMockup /></Reveal>
        </div>
      </section>

      {/* 3. Pays & secteurs couverts */}
      <section aria-label="Pays couverts" className="border-y bg-card/50 py-8">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <p className="text-sm text-muted-foreground">Conçu pour les entreprises de toute l'Afrique francophone et anglophone</p>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {CORE_COUNTRIES.map((c) => <li key={c.code} className="rounded-full border bg-background px-3.5 py-1.5 text-sm font-medium text-muted-foreground">{c.name}</li>)}
          </ul>
        </div>
      </section>

      {/* 4. Problèmes */}
      <Section eyebrow="Le constat" title="Piloter une entreprise ne devrait pas ressembler à ça" description="Trop d'outils, trop de ressaisies, trop peu de visibilité. Voilà ce que nous entendons le plus.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEMS.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.04}>
              <div className="h-full rounded-xl border bg-card p-6">
                <XCircle className="size-5 text-destructive/80" />
                <h3 className="mt-3 font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 5. Présentation */}
      <Section id="presentation" tone="muted" eyebrow="La solution" title="AfriGest 360 : le système central de votre entreprise" description="Un dirigeant doit pouvoir répondre en quelques secondes : combien gagnons-nous, qui nous doit de l'argent, que doit-on commander, quels projets sont en retard ?">
        <div className="grid gap-6 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.06}>
              <div className="h-full rounded-xl border bg-card p-7">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"><BarChart3 className="size-5" /></span>
                <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* 6. Modules */}
      <Section id="modules" eyebrow="Modules" title="Tout ce dont votre entreprise a besoin" description="Activez les modules selon votre offre. Les extensions métier se greffent sans transformer la plateforme.">
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
        <p className="mt-6 text-center text-sm text-muted-foreground">Fondations (comptes, rôles, entreprises, administration) disponibles ; modules métier livrés par étapes — <Link href="/fonctionnalites" className="text-brand hover:underline">voir le détail</Link>.</p>
      </Section>

      {/* 7. Fonctionnement */}
      <Section tone="muted" eyebrow="Fonctionnement" title="Opérationnel en quatre étapes">
        <ol className="grid gap-6 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06}>
              <li className="relative h-full rounded-xl border bg-card p-6">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{s.n}</span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* 8. Avantages */}
      <Section eyebrow="Avantages" title="Ce que vous gagnez concrètement">
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="flex gap-3">
              <Check className="mt-1 size-5 shrink-0 text-brand-green" />
              <div><h3 className="font-semibold">{b.title}</h3><p className="mt-1 text-sm text-muted-foreground">{b.text}</p></div>
            </div>
          ))}
        </div>
      </Section>

      {/* 9. Secteurs */}
      <Section tone="muted" eyebrow="Secteurs" title="Adapté à votre métier">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTORS_LIST.map((s) => (
            <div key={s.title} className="rounded-xl border bg-card p-5">
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm"><Link href="/solutions" className="text-brand hover:underline">Voir les solutions par fonction →</Link></p>
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
              {["Entreprise A — Administrateur", "Entreprise B — Responsable commercial", "Entreprise C — Consultation uniquement"].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />{t}</li>)}
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

      {/* 12. Intelligence & Analytics */}
      <Section eyebrow="Intelligence & Analytics" title="Des réponses, pas seulement des tableaux" description="Tableaux de bord exécutifs, rapports transversaux et assistant AfriGest Intelligence.">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border bg-card p-7">
            <h3 className="flex items-center gap-2 font-semibold"><BarChart3 className="size-5 text-brand" /> Pilotage</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {["Chiffre d'affaires, dépenses, résultat, trésorerie", "Factures à encaisser et échues, dettes fournisseurs", "Stocks critiques, projets en retard, validations en attente", "Analyses par agence, département, projet, centre de coûts", "Exports PDF et Excel"].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-green" />{t}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border bg-card p-7">
            <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="size-5 text-brand" /> AfriGest Intelligence <Badge variant="secondary">Bientôt</Badge></h3>
            <p className="mt-4 text-sm text-muted-foreground">Posez vos questions en français :</p>
            <ul className="mt-3 space-y-2 text-sm">
              {["« Quelles factures sont en retard ? »", "« Quels clients me doivent le plus d'argent ? »", "« Quels produits arrivent en rupture ? »", "« Quels projets dépassent leur budget ? »"].map((t) => <li key={t} className="rounded-lg bg-muted/60 px-3 py-2 italic text-muted-foreground">{t}</li>)}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">L'assistant n'accède jamais aux données d'une autre entreprise, ni aux modules désactivés, ni à ce que vos permissions interdisent.</p>
          </div>
        </div>
      </Section>

      {/* 13. Tarifs */}
      <Section id="tarifs" tone="muted" eyebrow="Tarifs" title="Des offres simples, qui évoluent avec vous" description="Essai gratuit inclus. Passez d'une offre à l'autre à tout moment.">
        <PricingTable plans={plans} />
        <p className="mt-8 text-center text-sm text-muted-foreground">Besoin d'un devis sur mesure ? <Link href="/contact" className="text-brand hover:underline">Contactez-nous</Link></p>
      </Section>

      {/* 14. Témoignages */}
      <Section eyebrow="Témoignages" title="Ce que les dirigeants attendent d'AfriGest 360" description="Cas d'usage types, formulés d'après les besoins que nous entendons sur le terrain.">
        <div className="grid gap-6 md:grid-cols-3">
          {USE_CASES.map((u) => (
            <figure key={u.initials} className="flex h-full flex-col rounded-2xl border bg-card p-6">
              <blockquote className="flex-1 text-sm leading-relaxed">« {u.quote} »</blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t pt-4">
                <span className="flex size-10 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{u.initials}</span>
                <span className="text-sm"><span className="block font-medium">{u.benefit}</span><span className="text-xs text-muted-foreground">{u.role}</span></span>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground">Profils illustratifs — pas de témoignages clients réels à ce jour.</p>
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
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Prêt à piloter toute votre entreprise depuis un seul endroit ?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-foreground/70">Un conseiller configure avec vous un environnement adapté à votre activité.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="secondary" asChild><Link href="#demo">Demander une démo</Link></Button>
            <Button size="lg" variant="outline" asChild className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"><Link href="/inscription">Créer un compte</Link></Button>
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
