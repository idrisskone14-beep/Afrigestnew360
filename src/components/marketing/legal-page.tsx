import Link from "next/link";
import { LEGAL_PAGES, LEGAL_UPDATED, TO_COMPLETE } from "@/lib/legal";

/** Mise en page commune des pages légales : titre, date de mise à jour, texte lisible et renvoi vers les deux autres documents. */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="eyebrow">Informations légales</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">Dernière mise à jour : {LEGAL_UPDATED}</p>
      <p className="mt-6 text-base text-muted-foreground">{intro}</p>
      <div className="mt-10 space-y-8 text-[15px] leading-relaxed [&_a]:text-brand [&_a]:underline-offset-2 hover:[&_a]:underline [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:mt-2 [&_ul]:space-y-1.5">
        {children}
      </div>
      <nav aria-label="Autres documents" className="mt-14 flex flex-wrap gap-x-6 gap-y-2 border-t pt-6 text-sm">
        {LEGAL_PAGES.map((p) => <Link key={p.href} href={p.href} className="text-brand hover:underline">{p.label}</Link>)}
      </nav>
    </article>
  );
}

/** Valeur issue de la configuration ; « [à compléter] » en évidence quand elle n'est pas renseignée. */
export function Val({ children }: { children: string }) {
  return children === TO_COMPLETE ? <mark className="rounded bg-warning/20 px-1 text-foreground">{children}</mark> : <>{children}</>;
}
