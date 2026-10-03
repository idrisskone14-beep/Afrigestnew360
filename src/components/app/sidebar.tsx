"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
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

function NavLink({ href, icon, children, active, onNavigate, trailing, index = 0 }: {
  href: string; icon: React.ReactNode; children: React.ReactNode; active: boolean; onNavigate?: () => void; trailing?: React.ReactNode; index?: number;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      style={{ animationDelay: `${Math.min(index, 14) * 28}ms` }}
      className={cn(
        "group relative flex animate-slide-in-left items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
        active ? "text-white" : "text-sidebar-foreground/75 hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="absolute inset-0 rounded-lg bg-gradient-to-r from-brand/90 to-brand-2/80 shadow-glow"
        />
      )}
      <span className={cn("relative z-10 shrink-0 transition-transform duration-200 group-hover:scale-110", active ? "text-white" : "text-indigo-300/80 group-hover:text-white")}>{icon}</span>
      <span className="relative z-10 truncate">{children}</span>
      {trailing && <span className="relative z-10 ml-auto">{trailing}</span>}
    </Link>
  );
}

export function SidebarContent({ modules, canSeeSettings, unreadCount, validations, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const is = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const standard = modules.filter((m) => m.kind === "STANDARD");
  const extensions = modules.filter((m) => m.kind === "EXTENSION");

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-sidebar bg-gradient-to-b from-[#0d1a4d] via-sidebar to-[#070d2b] text-sidebar-foreground">
      <div className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full bg-brand/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -right-16 size-56 rounded-full bg-brand-green/15 blur-3xl" aria-hidden />
      <div className="relative z-10 flex h-16 shrink-0 items-center border-b border-sidebar-border px-5">
        <Link href="/app/dashboard" onClick={onNavigate} className="text-white transition-transform hover:scale-[1.02]"><Logo /></Link>
      </div>

      <nav aria-label="Navigation principale" className="relative z-10 flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          <NavLink index={0} href="/app/dashboard" icon={<LayoutDashboard className="size-4" />} active={is("/app/dashboard")} onNavigate={onNavigate}>
            Tableau de bord
          </NavLink>
          {standard.map((m, i) => (
            <NavLink key={m.key} index={i + 1} href={m.href} icon={<ModuleIcon name={m.icon} className="size-4" />} active={is(m.href)} onNavigate={onNavigate}>
              {m.name}
            </NavLink>
          ))}
        </div>

        {extensions.length > 0 && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300/50">Extensions</p>
            {extensions.map((m, i) => (
              <NavLink key={m.key} index={standard.length + i + 2} href={m.href} icon={<ModuleIcon name={m.icon} className="size-4" />} active={is(m.href)} onNavigate={onNavigate}>
                {m.name}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="relative z-10 space-y-0.5 border-t border-sidebar-border bg-black/10 p-3">
        {validations && (
          <NavLink
            href="/app/validations"
            icon={<ClipboardCheck className="size-4" />}
            active={is("/app/validations")}
            onNavigate={onNavigate}
            trailing={validations.pending > 0 ? <Badge className="h-5 min-w-5 justify-center animate-pulse-glow bg-warning px-1.5 text-[11px] text-white">{validations.pending > 99 ? "99+" : validations.pending}</Badge> : null}
          >
            Validations
          </NavLink>
        )}
        <NavLink
          href="/app/notifications"
          icon={<Bell className="size-4" />}
          active={is("/app/notifications")}
          onNavigate={onNavigate}
          trailing={unreadCount > 0 ? <Badge className="h-5 min-w-5 justify-center bg-brand-green px-1.5 text-[11px] text-white">{unreadCount > 99 ? "99+" : unreadCount}</Badge> : null}
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
