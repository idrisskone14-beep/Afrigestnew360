"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";
import { ChevronRight } from "lucide-react";
import { MODULE_BY_KEY } from "@/core/modules/registry";
import type { NavModule } from "@/core/tenant/navigation";

const ModulesContext = createContext<NavModule[]>([]);

export function NavModulesProvider({ modules, children }: { modules: NavModule[]; children: React.ReactNode }) {
  return <ModulesContext.Provider value={modules}>{children}</ModulesContext.Provider>;
}

/** Éditeurs sans titre propre : titre de création et de modification, par « module/section ». */
const EDITOR_TITLES: Record<string, [string, string]> = {
  "accounting/ecritures": ["Nouvelle écriture", "Modifier l'écriture"],
  "purchases/commandes": ["Nouvelle commande fournisseur", "Modifier la commande fournisseur"],
  "purchases/demandes": ["Nouvelle demande d'achat", "Modifier la demande d'achat"],
  "purchases/factures": ["Nouvelle facture fournisseur", "Modifier la facture fournisseur"],
};
const EDITOR_PATH = /^\/app\/([a-z]+)\/([a-z-]+)\/(?:nouveau|[0-9a-f-]{36}\/modifier)$/;

/**
 * Titre et fil d'Ariane des pages de liste ou de synthèse d'un module, déduits de l'adresse et du sous-menu.
 * Les pages plus profondes (détail, création) portent leur propre en-tête : rien n'est affiché pour elles.
 */
export function ModuleHeader() {
  const pathname = usePathname().replace(/\/$/, "");
  const modules = useContext(ModulesContext);
  const m = modules.find((x) => pathname === x.href || pathname.startsWith(`${x.href}/`));
  if (!m) return null;
  const item = m.items.find((i) => i.href === pathname);
  const editor = EDITOR_PATH.exec(pathname);
  const editorTitles = editor ? EDITOR_TITLES[`${editor[1]}/${editor[2]}`] : undefined;
  if (editor && editorTitles) {
    const section = m.items.find((i) => i.href === `/app/${editor[1]}/${editor[2]}`);
    const title = pathname.endsWith("/nouveau") ? editorTitles[0] : editorTitles[1];
    return (
      <header className="mb-5 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <nav aria-label="Fil d'Ariane" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/app/dashboard" className="hover:text-foreground">Tableau de bord</Link>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <Link href={m.href} className="hover:text-foreground">{m.name}</Link>
          {section && <><ChevronRight className="size-3.5" aria-hidden="true" /><Link href={section.href} className="hover:text-foreground">{section.label}</Link></>}
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <span aria-current="page">{title}</span>
        </nav>
      </header>
    );
  }
  if (!item && pathname !== m.href) return null;
  const isRoot = pathname === m.href;
  const title = isRoot ? m.name : item!.label;
  const description = isRoot ? MODULE_BY_KEY.get(m.key)?.description : undefined;
  return (
    <header className="mb-5 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <nav aria-label="Fil d'Ariane" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/app/dashboard" className="hover:text-foreground">Tableau de bord</Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        {isRoot ? <span aria-current="page">{m.name}</span> : (
          <>
            <Link href={m.href} className="hover:text-foreground">{m.name}</Link>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <span aria-current="page">{title}</span>
          </>
        )}
      </nav>
      {description && <p className="max-w-2xl pt-1 text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}
