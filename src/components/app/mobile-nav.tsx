"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { Bell, Camera, ClipboardList, FileText, LayoutDashboard, Menu, Plus, Receipt, ScanBarcode, ShoppingBag, ShoppingCart, type LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ModuleIcon } from "./icons";
import { useNavCounts } from "./nav-counts";
import { ScanProductDialog } from "@/modules/inventory/ui/scan-product";
import { cn } from "@/lib/utils";
import type { NavModule } from "@/core/tenant/navigation";
import type { QuickAction } from "@/core/tenant/quick-actions";

const ICONS: Record<QuickAction["icon"], LucideIcon> = { FileText, Receipt, ShoppingBag, ShoppingCart, ClipboardList, ScanBarcode, Camera };

interface MenuState { open: boolean; setOpen: (v: boolean) => void }
const MenuContext = createContext<MenuState>({ open: false, setOpen: () => undefined });
export const useMobileMenu = () => useContext(MenuContext);

/** État du tiroir de navigation, partagé entre la barre du haut (bouton ☰) et la barre du bas (onglet « Menu »). */
export function MobileMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <MenuContext.Provider value={{ open, setOpen }}>{children}</MenuContext.Provider>;
}

const tab = "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors";

/**
 * Barre de navigation du bas (téléphone) : accueil, module principal, bouton « + » (gestes rapides), alertes, menu.
 * Pensée pour le pouce : cibles de 56 px, bouton central surélevé, respect de la zone de sécurité des iPhone.
 * Le module principal est Ventes s'il est disponible, sinon le premier module de l'utilisateur.
 */
export function MobileNav({ modules, quickActions }: { modules: NavModule[]; quickActions: QuickAction[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { unread } = useNavCounts();
  const menu = useMobileMenu();
  const [quickOpen, setQuickOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const main = modules.find((m) => m.key === "sales") ?? modules.find((m) => m.kind === "STANDARD") ?? modules[0];
  const on = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const run = (a: QuickAction) => {
    setQuickOpen(false);
    if (a.kind === "scan") return setScanOpen(true);
    if (a.href) router.push(a.href);
  };

  return (
    <>
      <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(11_31_68/0.08)] backdrop-blur lg:hidden">
        <ul className="mx-auto flex max-w-xl items-stretch">
          <li className="flex flex-1">
            <Link href="/app/dashboard" aria-current={on("/app/dashboard") ? "page" : undefined} className={cn(tab, on("/app/dashboard") ? "text-brand" : "text-muted-foreground")}>
              <LayoutDashboard className="size-5" aria-hidden="true" />Accueil
            </Link>
          </li>
          <li className="flex flex-1">
            {main ? (
              <Link href={main.href} aria-current={on(main.href) ? "page" : undefined} className={cn(tab, on(main.href) ? "text-brand" : "text-muted-foreground")}>
                <ModuleIcon name={main.icon} className="size-5" />{main.key === "sales" ? "Ventes" : main.name.split(/[ &]/)[0]}
              </Link>
            ) : <span className={tab} />}
          </li>
          <li className="flex flex-1 items-start justify-center">
            {quickActions.length > 0 && (
              <button
                type="button" onClick={() => setQuickOpen(true)} aria-label="Actions rapides" aria-haspopup="dialog"
                className="-mt-5 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-card transition-transform active:scale-95"
              >
                <Plus className="size-7" aria-hidden="true" />
              </button>
            )}
          </li>
          <li className="flex flex-1">
            <Link href="/app/notifications" aria-current={on("/app/notifications") ? "page" : undefined} className={cn(tab, on("/app/notifications") ? "text-brand" : "text-muted-foreground")}>
              <span className="relative"><Bell className="size-5" aria-hidden="true" />{unread > 0 && <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-brand-2 px-1 text-[10px] font-bold leading-4 text-brand-2-foreground">{unread > 9 ? "9+" : unread}</span>}</span>
              Alertes
            </Link>
          </li>
          <li className="flex flex-1">
            <button type="button" onClick={() => menu.setOpen(true)} className={cn(tab, "text-muted-foreground")}>
              <Menu className="size-5" aria-hidden="true" />Menu
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={quickOpen} onOpenChange={setQuickOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetTitle className="px-4 pt-4 text-lg">Que voulez-vous faire ?</SheetTitle>
          <SheetDescription className="sr-only">Actions rapides</SheetDescription>
          <ul className="grid grid-cols-2 gap-3 p-4">
            {quickActions.map((a) => {
              const Icon = ICONS[a.icon];
              return (
                <li key={a.key}>
                  <button type="button" onClick={() => run(a)} className="flex h-full min-h-24 w-full flex-col items-start justify-between gap-3 rounded-xl border bg-card p-4 text-left transition-colors active:bg-muted">
                    <span className="grid size-10 place-items-center rounded-lg bg-accent text-brand"><Icon className="size-5" aria-hidden="true" /></span>
                    <span className="text-sm font-semibold leading-tight">{a.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
      <ScanProductDialog open={scanOpen} onOpenChange={setScanOpen} />
    </>
  );
}
