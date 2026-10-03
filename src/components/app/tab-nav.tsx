"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Onglets de navigation d'un module (liens, rendu serveur des pages). `exact` : actif seulement sur l'URL exacte. */
export function TabNav({ tabs, label = "Sections" }: { tabs: { href: string; label: string; exact?: boolean }[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-1 mb-6 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined}
                className={cn("relative inline-block px-3 py-2.5 text-sm font-medium transition-colors", active ? "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
