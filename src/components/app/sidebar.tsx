"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, ChevronDown, ClipboardCheck, HelpCircle, LayoutDashboard, Settings } from "lucide-react";
import { ModuleIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { useNavCounts } from "./nav-counts";
import { cn } from "@/lib/utils";
import { FAMILIES, familyOfModule, type FamilyKey } from "@/core/tenant/module-nav";
import type { NavModule } from "@/core/tenant/navigation";

export interface SidebarProps {
  modules: NavModule[];
  canSeeSettings: boolean;
  unreadCount: number;
  /** Page « Validations » : null = masquée (pas de droit ou aucun module concerné actif). */
  validations?: { pending: number } | null;
  onNavigate?: () => void;
}

const moduleKeyOf = (pathname: string) => /^\/app\/([^/]+)/.exec(pathname)?.[1];

/** Famille ouverte : celle du module affiché ; sur le tableau de bord et les pages transverses, la première disponible. */
function activeFamily(pathname: string, modules: NavModule[]): FamilyKey | undefined {
  const fromPath = familyOfModule(moduleKeyOf(pathname) ?? "");
  if (fromPath && modules.some((m) => m.family === fromPath)) return fromPath;
  return FAMILIES.find((f) => modules.some((m) => m.family === f.key))?.key;
}

const itemClass = (active: boolean) => cn(
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
  active ? "bg-muted font-semibold text-brand" : "text-foreground/80 hover:bg-muted hover:text-foreground",
);

function PlainLink({ href, icon, children, active, onNavigate, trailing }: {
  href: string; icon: React.ReactNode; children: React.ReactNode; active: boolean; onNavigate?: () => void; trailing?: React.ReactNode;
}) {
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={itemClass(active)}>
      <span className={cn("shrink-0", active ? "text-brand" : "text-muted-foreground")}>{icon}</span>
      <span className="truncate">{children}</span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </Link>
  );
}

/** Module à sous-menu : groupe repliable, ouvert d'office quand on s'y trouve. */
function ModuleGroup({ module: m, pathname, onNavigate }: { module: NavModule; pathname: string; onNavigate?: () => void }) {
  const inModule = pathname === m.href || pathname.startsWith(`${m.href}/`);
  const [openByUser, setOpenByUser] = useState<boolean | null>(null);
  const open = openByUser ?? inModule;
  const panelId = `nav-${m.key}`;
  const activeHref = [...m.items].sort((a, b) => b.href.length - a.href.length).find((i) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`)))?.href;

  return (
    <div className={cn("rounded-lg", open && "bg-muted/60")}>
      <button
        type="button" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpenByUser(!open)}
        className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted", inModule ? "font-semibold text-foreground" : "text-foreground/80")}
      >
        <ModuleIcon name={m.icon} className={cn("size-4 shrink-0", inModule ? "text-brand" : "text-muted-foreground")} />
        <span className="truncate">{m.name}</span>
        <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200", open ? "rotate-0" : "-rotate-90")} aria-hidden="true" />
      </button>
      <div id={panelId} className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <ul className="min-h-0 overflow-hidden" inert={!open}>
          {m.items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href} onClick={onNavigate} aria-current={activeHref === i.href ? "page" : undefined}
                className={cn("block rounded-md py-2 pl-10 pr-3 text-sm transition-colors", activeHref === i.href ? "font-semibold text-brand" : "text-foreground/75 hover:bg-muted hover:text-foreground")}
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Rail d'icônes (à gauche) : tableau de bord et une tuile colorée par famille de modules. */
export function Rail({ modules, canSeeSettings }: Pick<SidebarProps, "modules" | "canSeeSettings">) {
  const pathname = usePathname();
  const current = activeFamily(pathname, modules);
  const onDashboard = pathname === "/app/dashboard";
  const tile = "grid size-9 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white shadow-sm transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <nav aria-label="Familles de modules" className="flex h-full flex-col items-center gap-2 py-3">
      <Link href="/app/dashboard" aria-label="Tableau de bord" title="Tableau de bord" aria-current={onDashboard ? "page" : undefined} className={cn("grid size-9 place-items-center rounded-lg transition-colors", onDashboard ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
        <LayoutDashboard className="size-[18px]" aria-hidden="true" />
      </Link>
      <span className="my-1 h-px w-7 bg-border" aria-hidden="true" />
      {FAMILIES.map((f) => {
        const first = modules.find((m) => m.family === f.key);
        if (!first) return null;
        const active = !onDashboard && current === f.key;
        return (
          <Link
            key={f.key} href={first.items[0]?.href ?? first.href} title={f.label} aria-label={f.label} aria-current={active ? "true" : undefined}
            style={{ backgroundColor: f.color }}
            className={cn(tile, active ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : "opacity-90 hover:opacity-100")}
          >
            {f.code}
          </Link>
        );
      })}
      {canSeeSettings && (
        <Link href="/app/parametres" aria-label="Paramètres" title="Paramètres" className={cn("mt-auto grid size-9 place-items-center rounded-lg transition-colors", pathname.startsWith("/app/parametres") ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
          <Settings className="size-[18px]" aria-hidden="true" />
        </Link>
      )}
    </nav>
  );
}

/** Menu latéral : le tableau de bord, les modules de la famille ouverte (ou tous, sur mobile) et les liens transverses. */
export function SidebarContent({ modules, canSeeSettings, validations, onNavigate, showAll = false }: SidebarProps & { showAll?: boolean }) {
  const counts = useNavCounts(); // compteurs chargés après l'affichage (voir nav-counts.tsx)
  const unreadCount = counts.unread;
  const pathname = usePathname();
  const is = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const family = activeFamily(pathname, modules);
  const groups = showAll
    ? FAMILIES.map((f) => ({ family: f, modules: modules.filter((m) => m.family === f.key) })).filter((g) => g.modules.length > 0)
    : [{ family: FAMILIES.find((f) => f.key === family), modules: modules.filter((m) => m.family === family) }];

  const renderModule = (m: NavModule) => m.items.length > 1
    ? <ModuleGroup key={m.key} module={m} pathname={pathname} onNavigate={onNavigate} />
    : <PlainLink key={m.key} href={m.items[0]?.href ?? m.href} icon={<ModuleIcon name={m.icon} className="size-4" />} active={is(m.href)} onNavigate={onNavigate}>{m.name}</PlainLink>;

  return (
    <div className="flex h-full flex-col bg-card text-foreground">
      <nav aria-label="Navigation principale" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <PlainLink href="/app/dashboard" icon={<LayoutDashboard className="size-4" />} active={is("/app/dashboard")} onNavigate={onNavigate}>Tableau de bord</PlainLink>
        {groups.map((g) => (
          <div key={g.family?.key ?? "none"} className="space-y-1 pt-2">
            {showAll && g.family && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.family.label}</p>}
            {g.modules.map(renderModule)}
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t p-3">
        {validations && (
          <PlainLink
            href="/app/validations" icon={<ClipboardCheck className="size-4" />} active={is("/app/validations")} onNavigate={onNavigate}
            trailing={counts.pending > 0 ? <Badge className="h-5 min-w-5 justify-center bg-brand-2 px-1.5 text-[11px] text-[#0b1f44]">{counts.pending > 99 ? "99+" : counts.pending}</Badge> : null}
          >
            Validations
          </PlainLink>
        )}
        <PlainLink
          href="/app/notifications" icon={<Bell className="size-4" />} active={is("/app/notifications")} onNavigate={onNavigate}
          trailing={unreadCount > 0 ? <Badge className="h-5 min-w-5 justify-center bg-brand px-1.5 text-[11px] text-brand-foreground">{unreadCount > 99 ? "99+" : unreadCount}</Badge> : null}
        >
          Notifications
        </PlainLink>
        {canSeeSettings && <PlainLink href="/app/parametres" icon={<Settings className="size-4" />} active={is("/app/parametres")} onNavigate={onNavigate}>Paramètres</PlainLink>}
        <PlainLink href="/app/aide" icon={<HelpCircle className="size-4" />} active={is("/app/aide")} onNavigate={onNavigate}>Aide</PlainLink>
      </div>
    </div>
  );
}
