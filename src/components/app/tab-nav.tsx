"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Onglets de navigation d'un module (liens, rendu serveur des pages). `exact` : actif seulement sur l'URL exacte. */
export function TabNav({ tabs, label = "Sections" }: { tabs: { href: string; label: string; exact?: boolean }[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-1 mb-6 overflow-x-auto pb-1">
      <ul className="flex min-w-max gap-1 rounded-xl border border-border/60 bg-card/70 p-1 shadow-soft backdrop-blur">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined}
                className={cn("relative inline-block rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-200", active ? "gradient-brand text-white shadow-[0_4px_12px_-4px_rgb(47_91_255/0.6)]" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
