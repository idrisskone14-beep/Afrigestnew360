"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Filtres du grand livre synchronisés avec l'URL : compte, période. */
export function LedgerFilters({ accounts }: { accounts: { id: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const push = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    router.push(`${pathname}${p.size ? `?${p}` : ""}`);
  };
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" role="search">
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground">Compte</label>
        <Select value={sp.get("compte") ?? undefined} onValueChange={(v) => push({ compte: v })}>
          <SelectTrigger className="w-72" aria-label="Compte"><SelectValue placeholder="Choisir un compte…" /></SelectTrigger>
          <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-1"><label htmlFor="gl-from" className="text-xs text-muted-foreground">Du</label><Input id="gl-from" type="date" className="w-40" defaultValue={sp.get("du") ?? ""} onChange={(e) => push({ du: e.target.value || null })} /></div>
      <div className="grid gap-1"><label htmlFor="gl-to" className="text-xs text-muted-foreground">Au</label><Input id="gl-to" type="date" className="w-40" defaultValue={sp.get("au") ?? ""} onChange={(e) => push({ au: e.target.value || null })} /></div>
    </div>
  );
}
