"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setYearAction } from "@/core/tenant/actions";

/** Année d'affichage : filtre les listes et leurs chiffres (cookie d'interface, rafraîchit la page). */
export function YearSelect({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value={String(year)}
      disabled={pending}
      onValueChange={(v) => start(async () => {
        const res = await setYearAction({ year: Number(v) });
        if (!res.ok) return void toast.error(res.error.message);
        router.refresh();
      })}
    >
      <SelectTrigger aria-label="Année affichée" className="h-10 w-36 bg-card sm:w-44"><SelectValue>Année {year}</SelectValue></SelectTrigger>
      <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>Année {y}</SelectItem>)}</SelectContent>
    </Select>
  );
}
