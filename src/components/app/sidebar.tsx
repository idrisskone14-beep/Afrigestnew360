"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ClipboardCheck, HelpCircle, LayoutDashboard, Settings } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ModuleIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NavModule } from "@/core/tenant/navigation";

export interface SidebarProps {
  modules: NavModule[];
  canSeeSettings: boolean;
  unreadCount: number;
  /** Page « Validations » : null = masquée (pas de droit ou aucun module concerné actif). */
  validations?: { pending: number } | null;
  onNavigate?: () => void;
}

function NavLink({ href, icon, children, active, onNavigate, trailing }: {
  href: string; icon: React.ReactNode; children: React.ReactNode; active: boolean; onNavigate?: () => void; trailing?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <span className={cn("shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")}>{icon}</span>
      <span className="truncate">{children}</span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </Link>
  );
}

export function SidebarContent({ modules, canSeeSettings, unreadCount, validations, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const is = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const standard = modules.filter((m) => m.kind === "STANDARD");
  const extensions = modules.filter((m) => m.kind === "EXTENSION");

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center px-5">
        <Link href="/app/dashboard" onClick={onNavigate}><Logo /></Link>
      </div>

      <nav aria-label="Navigation principale" className="flex-1 space-y-6 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          <NavLink href="/app/dashboard" icon={<LayoutDashboard className="size-4" />} active={is("/app/dashboard")} onNavigate={onNavigate}>
            Tableau de bord
          </NavLink>
          {standard.map((m) => (
            <NavLink key={m.key} href={m.href} icon={<ModuleIcon name={m.icon} className="size-4" />} active={is(m.href)} onNavigate={onNavigate}>
              {m.name}
            </NavLink>
          ))}
        </div>

        {extensions.length > 0 && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Extensions</p>
            {extensions.map((m) => (
              <NavLink key={m.key} href={m.href} icon={<ModuleIcon name={m.icon} className="size-4" />} active={is(m.href)} onNavigate={onNavigate}>
                {m.name}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border p-3">
        {validations && (
          <NavLink
            href="/app/validations"
            icon={<ClipboardCheck className="size-4" />}
            active={is("/app/validations")}
            onNavigate={onNavigate}
            trailing={validations.pending > 0 ? <Badge className="h-5 min-w-5 justify-center bg-warning px-1.5 text-[11px] text-white">{validations.pending > 99 ? "99+" : validations.pending}</Badge> : null}
          >
            Validations
          </NavLink>
        )}
        <NavLink
          href="/app/notifications"
          icon={<Bell className="size-4" />}
          active={is("/app/notifications")}
          onNavigate={onNavigate}
          trailing={unreadCount > 0 ? <Badge className="h-5 min-w-5 justify-center bg-brand px-1.5 text-[11px] text-brand-foreground">{unreadCount > 99 ? "99+" : unreadCount}</Badge> : null}
        >
          Notifications
        </NavLink>
        {canSeeSettings && (
          <NavLink href="/app/parametres" icon={<Settings className="size-4" />} active={is("/app/parametres")} onNavigate={onNavigate}>
            Paramètres
          </NavLink>
        )}
        <NavLink href="/app/aide" icon={<HelpCircle className="size-4" />} active={is("/app/aide")} onNavigate={onNavigate}>
          Aide
        </NavLink>
      </div>
    </div>
  );
}
