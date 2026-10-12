"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface Scope {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  register: (id: string) => () => void;
  toggleAll: () => void;
  allSelected: boolean | "indeterminate";
  clear: () => void;
  exportCsv: (onlySelected: boolean) => void;
}

const ScopeContext = createContext<Scope | null>(null);
const useScope = () => useContext(ScopeContext);

const clean = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  // un tableur interprète « = + @ » (et « - » suivi d'autre chose qu'un chiffre) comme une formule
  return /^[=+@]/.test(t) || /^-[^\d\s]/.test(t) ? `'${t}` : t;
};

/**
 * Portée d'une liste : cases à cocher des lignes, barre de sélection et export CSV de ce qui est affiché
 * (ou des lignes cochées). L'export lit le tableau à l'écran : il reprend exactement les colonnes et les filtres en cours.
 */
export function ListScope({ children, filename = "export" }: { children: React.ReactNode; filename?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const ids = useRef(new Set<string>());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rowCount, setRowCount] = useState(0);

  const toggle = useCallback((id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const register = useCallback((id: string) => {
    ids.current.add(id);
    setRowCount(ids.current.size);
    return () => { ids.current.delete(id); setRowCount(ids.current.size); setSelected((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; }); };
  }, []);
  const toggleAll = useCallback(() => setSelected((s) => (s.size === ids.current.size ? new Set() : new Set(ids.current))), []);
  const clear = useCallback(() => setSelected(new Set()), []);

  const exportCsv = useCallback((onlySelected: boolean) => {
    const table = root.current?.querySelector("table");
    if (!table) return;
    // les en-têtes sont affichés en capitales par le style : on lit le texte brut pour garder la casse d'origine
    const cells = (tr: Element) => [...tr.children].filter((c) => !c.querySelector("[role=checkbox]") && !c.querySelector("[data-no-export]")).map((c) => clean(c.tagName === "TH" ? (c.textContent ?? "") : (c as HTMLElement).innerText));
    const head = [...table.querySelectorAll("thead tr")].map(cells);
    const rows = [...table.querySelectorAll("tbody tr")].filter((tr) => !onlySelected || selected.has(tr.querySelector("[data-row-id]")?.getAttribute("data-row-id") ?? "")).map(cells);
    const csv = [...head, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filename, selected]);

  const value = useMemo<Scope>(() => ({
    selected, toggle, register, toggleAll, clear, exportCsv,
    allSelected: selected.size === 0 ? false : selected.size === rowCount ? true : "indeterminate",
  }), [selected, rowCount, toggle, register, toggleAll, clear, exportCsv]);

  return <ScopeContext.Provider value={value}><div ref={root}>{children}</div></ScopeContext.Provider>;
}

/** Bouton « Exporter » de la barre d'outils : CSV des lignes affichées. */
export function ExportButton() {
  const scope = useScope();
  if (!scope) return null;
  return <Button type="button" variant="outline" className="h-10 bg-card" onClick={() => scope.exportCsv(false)}>Exporter <Download className="size-4" /></Button>;
}

/** Barre affichée quand des lignes sont cochées. */
export function SelectionBar() {
  const scope = useScope();
  if (!scope || scope.selected.size === 0) return null;
  const n = scope.selected.size;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-accent px-4 py-2 text-sm text-accent-foreground">
      <span className="font-semibold">{n} ligne{n > 1 ? "s" : ""} sélectionnée{n > 1 ? "s" : ""}</span>
      <Button type="button" size="sm" variant="outline" className="bg-card" onClick={() => scope.exportCsv(true)}><Download className="size-4" /> Exporter la sélection</Button>
      <Button type="button" size="sm" variant="ghost" onClick={scope.clear}><X className="size-4" /> Désélectionner</Button>
    </div>
  );
}

export function SelectAllBox() {
  const scope = useScope();
  if (!scope) return null;
  return <Checkbox aria-label="Tout sélectionner" checked={scope.allSelected} onCheckedChange={scope.toggleAll} />;
}

export function RowBox({ id, label }: { id: string; label: string }) {
  const scope = useScope();
  const register = scope?.register;
  // inscription de la ligne dans la portée pendant sa présence à l'écran
  useEffect(() => register?.(id), [register, id]);
  if (!scope) return null;
  return <Checkbox data-row-id={id} aria-label={`Sélectionner ${label}`} checked={scope.selected.has(id)} onCheckedChange={() => scope.toggle(id)} />;
}
