"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FilterDef {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/** Barre de recherche + filtres synchronisés avec l'URL (rendu serveur, partageable, retour navigateur). */
export function ListToolbar({ placeholder = "Rechercher…", filters = [], children }: {
  placeholder?: string; filters?: FilterDef[]; children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const push = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    router.push(`${pathname}${p.size ? `?${p}` : ""}`);
  };

  // recherche différée : évite une requête par frappe
  useEffect(() => {
    if (q === (sp.get("q") ?? "")) return;
    const t = setTimeout(() => push({ q: q.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3" role="search">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-8" aria-label={placeholder} />
      </div>
      {filters.map((f) => (
        <Select key={f.name} value={sp.get(f.name) ?? "all"} onValueChange={(v) => push({ [f.name]: v === "all" ? null : v })}>
          <SelectTrigger className="w-44" aria-label={f.label}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{f.label} : tous</SelectItem>
            {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ))}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}
