import { MobileMenuProvider, MobileNav } from "@/components/app/mobile-nav";
import { NavCountsProvider } from "@/components/app/nav-counts";
import { PwaRegister } from "@/components/app/pwa-register";
import { NavModulesProvider } from "@/components/app/module-header";
import { Rail, SidebarContent } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { loadContextState } from "@/core/tenant/context";
import { canSeeValidations } from "@/core/approvals";
import { visibleModules } from "@/core/tenant/navigation";
import { quickActionsFor } from "@/core/tenant/quick-actions";
import { selectedYear } from "@/core/tenant/period";
import { yearOptions } from "@/lib/period";
import { countryName } from "@/lib/reference-data";
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
  const quickActions = quickActionsFor(ctx);
  const year = await selectedYear();
  const country = ctx.company.country ? { code: ctx.company.country, name: countryName(ctx.company.country) } : null;

  return (
    <NavCountsProvider>
      <NavModulesProvider modules={modules}>
        <MobileMenuProvider>
        <PwaRegister />
        <div className="min-h-dvh">
          <Topbar
            nav={nav}
            companies={ctx.switcher}
            activeCompanyId={ctx.company.id}
            user={{ name: ctx.user.name, email: ctx.user.email, isPlatformAdmin: ctx.user.isPlatformAdmin }}
            country={country}
            year={year}
            years={yearOptions(year)}
          />
          <div className="lg:flex">
            <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 border-r lg:flex">
              <div className="w-14 border-r bg-card"><Rail modules={modules} canSeeSettings={canSeeSettings} /></div>
              <div className="w-60"><SidebarContent {...nav} /></div>
            </aside>
            <main className="mx-auto w-full min-w-0 max-w-[1500px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-6">{children}</main>
          </div>
          <MobileNav modules={modules} quickActions={quickActions} />
        </div>
        </MobileMenuProvider>
      </NavModulesProvider>
    </NavCountsProvider>
  );
}
