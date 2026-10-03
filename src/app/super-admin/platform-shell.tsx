"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, BarChart3, Building2, Inbox, LayoutGrid, Layers, Menu, Shield } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/super-admin", label: "Vue d'ensemble", icon: BarChart3, exact: true },
  { href: "/super-admin/entreprises", label: "Entreprises", icon: Building2 },
  { href: "/super-admin/offres", label: "Offres", icon: Layers },
  { href: "/super-admin/modules", label: "Modules", icon: LayoutGrid },
  { href: "/super-admin/demandes", label: "Demandes de démo", icon: Inbox },
];

function Nav({ newDemos, onNavigate }: { newDemos: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-primary text-primary-foreground dark:bg-sidebar dark:text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-5">
        <Logo />
        <Badge className="ml-1 bg-brand/90 text-[10px] text-white hover:bg-brand/90">ADMIN</Badge>
      </div>
      <nav aria-label="Console plateforme" className="flex-1 space-y-0.5 px-3 py-3">
        {NAV.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white")}>
              <n.icon className="size-4" />
              {n.label}
              {n.href.endsWith("demandes") && newDemos > 0 && <Badge className="ml-auto h-5 bg-brand-green px-1.5 text-[11px] text-white hover:bg-brand-green">{newDemos}</Badge>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <Link href="/app" onClick={onNavigate} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
          <ArrowLeft className="size-4" /> Retour à l'application
        </Link>
      </div>
    </div>
  );
}

export function PlatformShell({ user, newDemos, children }: { user: { name: string; email: string }; newDemos: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 lg:block"><Nav newDemos={newDemos} /></aside>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}><Menu className="size-5" /></Button>
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Shield className="size-4 text-brand" /> Console propriétaire de la plateforme</span>
        <div className="ml-auto flex items-center gap-1 sm:gap-2"><ThemeToggle /><UserMenu name={user.name} email={user.email} isPlatformAdmin /></div>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-0 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navigation de la console plateforme</SheetDescription>
          <Nav newDemos={newDemos} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
