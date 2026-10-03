"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchCompanyAction } from "@/core/tenant/actions";
import type { SwitcherItem } from "@/core/tenant/context";
import { initials } from "@/lib/utils";

export function CompanySwitcher({ activeId, items }: { activeId: string; items: SwitcherItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = items.find((i) => i.companyId === activeId) ?? items[0]!;

  const select = (companyId: string) => {
    if (companyId === activeId) return;
    start(async () => {
      const res = await switchCompanyAction({ companyId });
      if (!res.ok) return void toast.error(res.error.message);
      router.refresh();
      toast.success("Entreprise changée");
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 max-w-[15rem] gap-2.5 px-2" aria-label="Changer d'entreprise">
          <Avatar className="size-7 rounded-md">
            {active.logoUrl && <AvatarImage src={active.logoUrl} alt="" className="rounded-md object-contain" />}
            <AvatarFallback className="rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">{initials(active.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-col items-start text-left leading-tight sm:flex">
            <span className="max-w-[9.5rem] truncate text-sm font-medium">{active.name}</span>
            <span className="max-w-[9.5rem] truncate text-[11px] text-muted-foreground">{active.roleName}</span>
          </span>
          {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ChevronsUpDown className="size-4 text-muted-foreground" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Vos entreprises</DropdownMenuLabel>
        {items.map((i) => (
          <DropdownMenuItem key={i.companyId} disabled={i.suspended} onSelect={() => select(i.companyId)} className="gap-2.5">
            <Avatar className="size-7 rounded-md">
              {i.logoUrl && <AvatarImage src={i.logoUrl} alt="" className="rounded-md object-contain" />}
              <AvatarFallback className="rounded-md text-[11px] font-semibold">{initials(i.name)}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{i.name}</span>
              <span className="truncate text-xs text-muted-foreground">{i.suspended ? "Suspendue" : i.roleName}</span>
            </span>
            {i.companyId === activeId && <Check className="size-4 text-brand" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/onboarding?new=1")} className="text-muted-foreground">
          + Créer une entreprise
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
