"use client";

import Link from "next/link";
import { LogOut, ShieldCheck, Shield, UserCog } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/core/auth/actions";
import { initials } from "@/lib/utils";

export function UserMenu({ name, email, isPlatformAdmin }: { name: string; email: string; isPlatformAdmin: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu du compte">
          <Avatar className="size-8">
            <AvatarFallback className="bg-brand text-xs font-semibold text-brand-foreground">{initials(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/parametres/securite"><ShieldCheck className="size-4" /> Sécurité du compte</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/parametres"><UserCog className="size-4" /> Paramètres</Link>
        </DropdownMenuItem>
        {isPlatformAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/super-admin"><Shield className="size-4" /> Console Super Admin</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full"><LogOut className="size-4" /> Se déconnecter</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
