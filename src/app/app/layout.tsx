import { NavCountsProvider } from "@/components/app/nav-counts";
import { Topbar } from "@/components/app/topbar";
import { SidebarContent } from "@/components/app/sidebar";
import { loadContextState } from "@/core/tenant/context";
import { canSeeValidations } from "@/core/approvals";
import { visibleModules } from "@/core/tenant/navigation";
import { redirect } from "next/navigation";

/**
 * Layout de l'application. Il tolère les états « sans entreprise » (onboarding) et « suspendue »
 * pour que ces pages s'affichent ; toutes les autres pages exigent un contexte complet.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const state = await loadContextState();
  if (state.status === "unauthenticated") redirect("/connexion");

  if (state.status !== "ok") {
    return <div className="min-h-dvh bg-background">{children}</div>;
  }

  const { ctx } = state;
  const modules = visibleModules(ctx);
  const canSeeSettings = ctx.can("settings.company.read") || ctx.can("users.member.read") || ctx.can("roles.role.read") || ctx.can("settings.billing.read");
  // Les compteurs (notifications non lues, validations en attente) ne sont PAS calculés ici : ils ralentiraient l'affichage
  // de toutes les pages. Ils arrivent juste après, via /api/nav/counts (voir NavCountsProvider).
  const nav = { modules, canSeeSettings, unreadCount: 0, validations: canSeeValidations(ctx) ? { pending: 0 } : null };

  return (
    <NavCountsProvider>
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-sidebar-border lg:block">
        <SidebarContent {...nav} />
      </aside>
      <Topbar
        nav={nav}
        companies={ctx.switcher}
        activeCompanyId={ctx.company.id}
        user={{ name: ctx.user.name, email: ctx.user.email, isPlatformAdmin: ctx.user.isPlatformAdmin }}
      />
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
    </NavCountsProvider>
  );
}
