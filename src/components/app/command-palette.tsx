"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Building2, HelpCircle, LayoutDashboard, Moon, Search, Settings, ShieldCheck, Users } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { switchCompanyAction } from "@/core/tenant/actions";
import { globalSearchAction } from "@/modules/search/actions";
import type { SearchGroup } from "@/modules/search/service";
import type { SwitcherItem } from "@/core/tenant/context";
import type { NavModule } from "@/core/tenant/navigation";
import { ModuleIcon } from "./icons";

/**
 * Palette de commandes (Ctrl/Cmd + K) : navigation, entreprises, préférences, et recherche globale d'entités
 * (clients, fournisseurs, factures, devis, salariés, produits, projets, documents). La recherche est exécutée par le
 * serveur, uniquement sur les types que l'utilisateur peut lire, dans son entreprise active.
 */
export function CommandPalette({ modules, companies, activeCompanyId, canSeeSettings }: {
  modules: NavModule[]; companies: SwitcherItem[]; activeCompanyId: string; canSeeSettings: boolean;
}) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  // Recherche différée ; une réponse tardive d'une ancienne frappe est ignorée
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await globalSearchAction({ q });
      if (id !== seq.current) return;
      setResults(res.ok ? res.data : []);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  const shown = query.trim().length >= 2 ? results : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback((href: string) => { setOpen(false); setQuery(""); router.push(href); }, [router]);

  const switchTo = async (companyId: string) => {
    setOpen(false);
    const res = await switchCompanyAction({ companyId });
    if (!res.ok) return void toast.error(res.error.message);
    router.refresh();
    toast.success("Entreprise changée");
  };

  return (
    <>
      <Button
        variant="outline"
        className="h-9 w-9 justify-center gap-2 px-0 text-muted-foreground sm:w-64 sm:justify-start sm:px-3"
        onClick={() => setOpen(true)}
        aria-label="Rechercher ou aller à… (Ctrl+K)"
      >
        <Search className="size-4" />
        <span className="hidden text-sm font-normal sm:inline">Rechercher…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-sans text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }} title="Palette de commandes" description="Naviguez rapidement dans AfriGest 360">
        <CommandInput placeholder="Rechercher un client, une facture, un salarié… ou aller à…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{searching ? "Recherche…" : "Aucun résultat."}</CommandEmpty>
          {shown.map((g) => (
            <CommandGroup key={g.type} heading={g.label}>
              {g.items.map((it) => (
                // la valeur contient la saisie : le filtre local de cmdk ne masque pas les résultats serveur
                <CommandItem key={it.id} value={`${query} ${g.type} ${it.label} ${it.id}`} onSelect={() => go(it.href)}>
                  <span className="truncate">{it.label}</span>{it.sub && <span className="ml-auto truncate text-xs text-muted-foreground">{it.sub}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {shown.length > 0 && <CommandSeparator />}
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => go("/app/dashboard")}><LayoutDashboard /> Tableau de bord</CommandItem>
            {modules.map((m) => (
              <CommandItem key={m.key} value={m.name} onSelect={() => go(m.href)}><ModuleIcon name={m.icon} /> {m.name}</CommandItem>
            ))}
            <CommandItem onSelect={() => go("/app/notifications")}><Bell /> Notifications</CommandItem>
            <CommandItem onSelect={() => go("/app/aide")}><HelpCircle /> Aide</CommandItem>
          </CommandGroup>
          {canSeeSettings && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Paramètres">
                <CommandItem onSelect={() => go("/app/parametres")}><Settings /> Paramètres de l'entreprise</CommandItem>
                <CommandItem onSelect={() => go("/app/parametres/utilisateurs")}><Users /> Utilisateurs et invitations</CommandItem>
                <CommandItem onSelect={() => go("/app/parametres/roles")}><ShieldCheck /> Rôles et permissions</CommandItem>
              </CommandGroup>
            </>
          )}
          {companies.length > 1 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Changer d'entreprise">
                {companies.filter((c) => c.companyId !== activeCompanyId && !c.suspended).map((c) => (
                  <CommandItem key={c.companyId} value={`entreprise ${c.name}`} onSelect={() => switchTo(c.companyId)}>
                    <Building2 /> {c.name} <span className="ml-auto text-xs text-muted-foreground">{c.roleName}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          <CommandSeparator />
          <CommandGroup heading="Préférences">
            <CommandItem onSelect={() => { setTheme(resolvedTheme === "dark" ? "light" : "dark"); setOpen(false); }}>
              <Moon /> Basculer le thème clair/sombre
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
