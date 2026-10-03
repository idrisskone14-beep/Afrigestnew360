"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const MARKETING_NAV = [
  { href: "/fonctionnalites", label: "Fonctionnalités" },
  { href: "/solutions", label: "Solutions" },
  { href: "/tarifs", label: "Tarifs" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="AfriGest 360 — accueil"><Logo /></Link>
        <nav aria-label="Navigation principale" className="ml-4 hidden items-center gap-1 md:flex">
          {MARKETING_NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={pathname === n.href ? "page" : undefined}
              className={cn("rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-foreground", pathname === n.href ? "text-foreground" : "text-muted-foreground")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <Button asChild><Link href="/app">Ouvrir l'application</Link></Button>
          ) : (
            <>
              <Button variant="ghost" asChild className="hidden sm:inline-flex"><Link href="/connexion">Connexion</Link></Button>
              <Button asChild className="hidden sm:inline-flex"><Link href="/demo">Demander une démo</Link></Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}><Menu className="size-5" /></Button>
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-72">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navigation du site</SheetDescription>
          <nav className="mt-10 grid gap-1 px-4">
            {MARKETING_NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted">{n.label}</Link>
            ))}
            <div className="mt-4 grid gap-2">
              {signedIn ? (
                <Button asChild><Link href="/app" onClick={() => setOpen(false)}>Ouvrir l'application</Link></Button>
              ) : (
                <>
                  <Button asChild><Link href="/demo" onClick={() => setOpen(false)}>Demander une démo</Link></Button>
                  <Button variant="outline" asChild><Link href="/connexion" onClick={() => setOpen(false)}>Connexion</Link></Button>
                  <Button variant="ghost" asChild><Link href="/inscription" onClick={() => setOpen(false)}>Créer un compte</Link></Button>
                </>
              )}
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
