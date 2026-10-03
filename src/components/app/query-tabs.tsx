import Link from "next/link";
import { cn } from "@/lib/utils";

/** Onglets pilotés par un paramètre d'URL (rendu serveur, partageables, retour navigateur). */
export function QueryTabs({ tabs, current, basePath, param = "onglet", label = "Sections" }: { tabs: { key: string; label: string }[]; current: string; basePath: string; param?: string; label?: string }) {
  return (
    <nav aria-label={label} className="-mx-1 mb-4 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link href={t.key === tabs[0]!.key ? basePath : `${basePath}?${param}=${t.key}`} aria-current={t.key === current ? "page" : undefined}
              className={cn("relative inline-block px-3 py-2.5 text-sm font-medium transition-colors", t.key === current ? "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
