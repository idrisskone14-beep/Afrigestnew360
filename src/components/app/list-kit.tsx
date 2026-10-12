"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Calendar, Check, Search, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExportButton } from "./data-list";
import { cn } from "@/lib/utils";

export interface FilterDef {
  name: string;
  label: string;
  /** `date` : intervalle « du … au … » (paramètres `<name>_du` et `<name>_au`) ; sinon liste de valeurs. */
  kind?: "date";
  options?: { value: string; label: string }[];
}

const chip = "inline-flex h-10 items-center gap-2 rounded-lg border border-dashed bg-card px-3 text-sm font-medium transition-colors hover:bg-muted data-[active=true]:border-solid data-[active=true]:border-brand data-[active=true]:bg-accent data-[active=true]:text-accent-foreground";

type Push = (patch: Record<string, string | null>) => void;

function ValueChip({ f, value, push }: { f: FilterDef; value: string | null; push: Push }) {
  const [open, setOpen] = useState(false);
  const current = f.options?.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={chip} data-active={Boolean(current)} aria-label={`Filtrer : ${f.label}`}>
          <Tag className="size-4" aria-hidden="true" />
          {f.label}{current && <span className="font-normal">: {current.label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <ul>
          {[{ value: "", label: "Tous" }, ...(f.options ?? [])].map((o) => {
            const selected = (value ?? "") === o.value;
            return (
              <li key={o.value || "all"}>
                <button
                  type="button"
                  onClick={() => { push({ [f.name]: o.value || null }); setOpen(false); }}
                  className={cn("flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted", selected && "font-semibold")}
                >
                  {o.label}{selected && <Check className="size-4 text-brand" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function DateChip({ f, from, to, push }: { f: FilterDef; from: string; to: string; push: Push }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const active = Boolean(from || to);
  const fr = (v: string) => (v ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${v}T12:00:00`)) : "…");
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setA(from); setB(to); } }}>
      <PopoverTrigger asChild>
        <button type="button" className={chip} data-active={active} aria-label={`Filtrer : ${f.label}`}>
          <Calendar className="size-4" aria-hidden="true" />
          {f.label}{active && <span className="font-normal">: {fr(from)} → {fr(to)}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <label className="grid gap-1 text-sm">Du<Input type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Au<Input type="date" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} /></label>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => { push({ [`${f.name}_du`]: null, [`${f.name}_au`]: null }); setOpen(false); }}>Effacer</Button>
          <Button type="button" size="sm" onClick={() => { push({ [`${f.name}_du`]: a || null, [`${f.name}_au`]: b || null }); setOpen(false); }}>Appliquer</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Barre de recherche + filtres en pastilles synchronisés avec l'URL (rendu serveur, partageable, retour navigateur). */
export function ListToolbar({ placeholder = "Rechercher…", filters = [], hideSearch = false, children }: {
  placeholder?: string; filters?: FilterDef[]; hideSearch?: boolean; children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const push: Push = (patch) => {
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

  const anyFilter = filters.some((f) => (f.kind === "date" ? sp.get(`${f.name}_du`) || sp.get(`${f.name}_au`) : sp.get(f.name))) || Boolean(sp.get("q"));
  const reset = () => {
    const p = new URLSearchParams(sp.toString());
    for (const f of filters) { p.delete(f.name); p.delete(`${f.name}_du`); p.delete(`${f.name}_au`); }
    p.delete("q"); p.delete("page");
    setQ("");
    router.push(`${pathname}${p.size ? `?${p}` : ""}`);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search">
      {!hideSearch && <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-10 bg-card pl-9" aria-label={placeholder} />
      </div>}
      {filters.map((f) => f.kind === "date"
        ? <DateChip key={f.name} f={f} from={sp.get(`${f.name}_du`) ?? ""} to={sp.get(`${f.name}_au`) ?? ""} push={push} />
        : <ValueChip key={f.name} f={f} value={sp.get(f.name)} push={push} />)}
      {anyFilter && <Button type="button" variant="ghost" size="sm" onClick={reset}><X className="size-4" /> Réinitialiser</Button>}
      <div className="ml-auto flex items-center gap-2">
        <ExportButton />
        {children}
      </div>
    </div>
  );
}
