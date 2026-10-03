import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const COLUMNS = [
  { title: "Produit", links: [{ href: "/fonctionnalites", label: "Fonctionnalités" }, { href: "/solutions", label: "Solutions par métier" }, { href: "/tarifs", label: "Tarifs" }, { href: "/demo", label: "Demander une démo" }] },
  { title: "Entreprise", links: [{ href: "/contact", label: "Contact" }, { href: "/inscription", label: "Créer un compte" }, { href: "/connexion", label: "Connexion" }] },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm text-muted-foreground">Toute votre entreprise. Une seule plateforme. Finances, ventes, stocks, RH, projets et opérations réunis, pensés pour les entreprises africaines.</p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="text-sm font-semibold">{c.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {c.links.map((l) => <li key={l.href}><Link href={l.href} className="text-muted-foreground transition-colors hover:text-foreground">{l.label}</Link></li>)}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">© {new Date().getFullYear()} AfriGest 360. Tous droits réservés.</p>
      </div>
    </footer>
  );
}
