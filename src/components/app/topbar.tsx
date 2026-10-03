"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CommandPalette } from "./command-palette";
import { CompanySwitcher } from "./company-switcher";
import { SidebarContent, type SidebarProps } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import type { SwitcherItem } from "@/core/tenant/context";

export function Topbar({ nav, companies, activeCompanyId, user }: {
  nav: Omit<SidebarProps, "onNavigate">;
  companies: SwitcherItem[];
  activeCompanyId: string;
  user: { name: string; email: string; isPlatformAdmin: boolean };
}) {
  const [drawer, setDrawer] = useState(false);
  return (
    <header className="glass sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border px-3 sm:px-5">
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Ouvrir le menu"><Menu className="size-5" /></Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
          <SheetDescription className="sr-only">Navigation principale de l'application</SheetDescription>
          <SidebarContent {...nav} onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <CompanySwitcher activeId={activeCompanyId} items={companies} />
      <div className="mx-auto hidden flex-1 md:block" />
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <CommandPalette modules={nav.modules} companies={companies} activeCompanyId={activeCompanyId} canSeeSettings={nav.canSeeSettings} />
        <Button variant="ghost" size="icon" asChild className="relative" aria-label="Notifications">
          <Link href="/app/notifications">
            <Bell className="size-4" />
            {nav.unreadCount > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full animate-pulse-glow bg-brand-2 ring-2 ring-background" />}
          </Link>
        </Button>
        <ThemeToggle />
        <UserMenu {...user} />
      </div>
    </header>
  );
}
