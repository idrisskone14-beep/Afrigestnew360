"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAGE_SIZES } from "@/lib/list-params";

/** Nombre de lignes par page : écrit `lignes` dans l'URL (la liste est rendue côté serveur) et revient à la page 1. */
export function PageSizeSelect({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <label className="flex items-center gap-2">
      <span>Lignes</span>
      <Select
        value={String(value)}
        onValueChange={(v) => {
          const p = new URLSearchParams(sp.toString());
          p.set("lignes", v);
          p.delete("page");
          router.push(`${pathname}?${p}`);
        }}
      >
        <SelectTrigger size="sm" className="w-[4.5rem] bg-card" aria-label="Lignes par page"><SelectValue /></SelectTrigger>
        <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  );
}
