"use client";

import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CommandPalette } from "./command-palette";
import { useMobileMenu } from "./mobile-nav";
import { CompanySwitcher } from "./company-switcher";
import { useNavCounts } from "./nav-counts";
import { SidebarContent, type SidebarProps } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { YearSelect } from "./year-select";
import type { SwitcherItem } from "@/core/tenant/context";

export function Topbar({ nav, companies, activeCompanyId, user, country, year, years }: {
  nav: Omit<SidebarProps, "onNavigate">;
  companies: SwitcherItem[];
  activeCompanyId: string;
  user: { name: string; email: string; isPlatformAdmin: boolean };
  country: { code: string; name: string } | null;
  year: number;
  years: number[];
}) {
  const { open: drawer, setOpen: setDrawer } = useMobileMenu();
  const { unread } = useNavCounts();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-3 sm:gap-3 sm:px-4">
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Ouvrir le menu"><Menu className="size-5" /></Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
          <SheetDescription className="sr-only">Navigation principale de l'application</SheetDescription>
          <SidebarContent {...nav} showAll onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <Link href="/app/dashboard" className="shrink-0 lg:w-[16.5rem]" aria-label="AfriGest 360, tableau de bord"><Logo className="max-sm:[&>span]:hidden" /></Link>

      {country && (
        <span className="hidden h-10 items-center gap-2 rounded-lg border bg-card px-3 text-sm lg:inline-flex" title="Pays de l'entreprise">
          <span className="grid size-5 place-items-center rounded-full bg-brand-blue text-[9px] font-bold text-white" aria-hidden="true">{country.code}</span>
          {country.name}
        </span>
      )}
      <CompanySwitcher activeId={activeCompanyId} items={companies} />
      <div className="hidden sm:block"><YearSelect year={year} years={years} /></div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <CommandPalette modules={nav.modules} companies={companies} activeCompanyId={activeCompanyId} canSeeSettings={nav.canSeeSettings} />
        <div className="hidden sm:block"><ThemeToggle /></div>
        <Button variant="ghost" size="icon" asChild className="relative" aria-label="Notifications">
          <Link href="/app/notifications">
            <Bell className={unread > 0 ? "size-4 origin-top animate-[wiggle_1.4s_ease-in-out_1.8s_3]" : "size-4"} />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand-2 ring-2 ring-card" />}
          </Link>
        </Button>
        <UserMenu {...user} />
      </div>
    </header>
  );
}
