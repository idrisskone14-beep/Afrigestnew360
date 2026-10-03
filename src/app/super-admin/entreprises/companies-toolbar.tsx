"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CompaniesToolbar({ q, status }: { q: string; status: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const go = (nextQ: string, nextStatus: string) => {
    const p = new URLSearchParams();
    if (nextQ.trim()) p.set("q", nextQ.trim());
    if (nextStatus) p.set("statut", nextStatus);
    router.push(`/super-admin/entreprises${p.size ? `?${p}` : ""}`);
  };
  return (
    <form className="mb-4 flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); go(query, status); }} role="search">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une entreprise…" className="pl-8" aria-label="Rechercher une entreprise" />
      </div>
      <Select value={status || "all"} onValueChange={(v) => go(query, v === "all" ? "" : v)}>
        <SelectTrigger className="w-44" aria-label="Filtrer par statut"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          <SelectItem value="ACTIVE">Actives</SelectItem>
          <SelectItem value="SUSPENDED">Suspendues</SelectItem>
        </SelectContent>
      </Select>
    </form>
  );
}
