"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Onglets de navigation d'un module (liens, rendu serveur des pages). `exact` : actif seulement sur l'URL exacte. */
export function TabNav({ tabs, label = "Sections" }: { tabs: { href: string; label: string; exact?: boolean }[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-1 mb-6 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined}
                className={cn("relative inline-block px-3.5 py-2.5 text-sm font-medium transition-colors duration-200 after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:origin-left after:rounded-t after:bg-brand after:transition-transform after:duration-300", active ? "text-foreground after:scale-x-100" : "text-muted-foreground after:scale-x-0 hover:text-foreground hover:after:scale-x-50")}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
