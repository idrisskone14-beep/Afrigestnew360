"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ALL = "all";

/** Filtres du suivi des congés : mois (précédent / suivant), service et type de congé des soldes — dans l'adresse, donc partageables. */
export function LeaveFilters({ year, month, departmentId, typeId, departments, types }: {
  year: number; month: number; departmentId: string; typeId: string; departments: { id: string; name: string }[]; types: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    router.push(`${pathname}?${p}`);
  };
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    go({ mois: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filtres du suivi des congés">
      <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
        <Button variant="ghost" size="icon" aria-label="Mois précédent" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
        <span className="min-w-36 text-center text-sm font-semibold capitalize" aria-live="polite">{MONTHS[month - 1]} {year}</span>
        <Button variant="ghost" size="icon" aria-label="Mois suivant" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
      </div>
      <Button variant="outline" className="h-10 bg-card" onClick={() => go({ mois: null })}>Aujourd&apos;hui</Button>
      <Select value={departmentId || ALL} onValueChange={(v) => go({ service: v === ALL ? null : v })}>
        <SelectTrigger className="h-10 w-48 bg-card" aria-label="Service"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>Tous les services</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={typeId || undefined} onValueChange={(v) => go({ type: v })}>
        <SelectTrigger className="h-10 w-52 bg-card" aria-label="Type de congé des soldes"><SelectValue placeholder="Soldes : type de congé" /></SelectTrigger>
        <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>Soldes : {t.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
