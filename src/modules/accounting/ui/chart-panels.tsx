"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/components/app/form-kit";
import { createLedgerAccountAction, setMappingAction, updateLedgerAccountAction } from "../actions";

export interface AccountRow { id: string; code: string; name: string; class: number; isActive: boolean }
const CLASS_LABEL: Record<number, string> = { 1: "Classe 1 — Ressources durables", 2: "Classe 2 — Actif immobilisé", 3: "Classe 3 — Stocks", 4: "Classe 4 — Tiers", 5: "Classe 5 — Trésorerie", 6: "Classe 6 — Charges", 7: "Classe 7 — Produits", 8: "Classe 8 — Hors activités ordinaires" };

export function ChartPanel({ accounts, canManage }: { accounts: AccountRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const shown = accounts.filter((a) => !q || a.code.startsWith(q) || a.name.toLowerCase().includes(q.toLowerCase()));
  const classes = [...new Set(shown.map((a) => a.class))].sort();
  const update = (a: AccountRow, patch: { name?: string; isActive?: boolean }) => start(async () => {
    const r = await runAction(updateLedgerAccountAction({ id: a.id, name: patch.name ?? a.name, isActive: patch.isActive ?? a.isActive }), { success: "Compte mis à jour" });
    if (r.ok) { setEditing(null); router.refresh(); }
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un compte…" aria-label="Rechercher un compte" />
        <p className="text-xs text-muted-foreground">{accounts.length} comptes · plan compatible SYSCOHADA, à valider avec votre expert-comptable.</p>
      </div>
      {canManage && (
        <Card className="flex flex-wrap items-end gap-2 p-3">
          <div className="grid gap-1"><label htmlFor="la-code" className="text-xs text-muted-foreground">Nouveau compte — code</label><Input id="la-code" className="h-9 w-32" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="ex. 6241" /></div>
          <div className="grid gap-1"><label htmlFor="la-name" className="text-xs text-muted-foreground">Libellé</label><Input id="la-name" className="h-9 w-72" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <Button disabled={pending || !/^[1-8]\d{2,7}$/.test(code) || name.trim().length < 2} onClick={() => start(async () => { const r = await runAction(createLedgerAccountAction({ code, name }), { success: "Compte créé" }); if (r.ok) { setCode(""); setName(""); router.refresh(); } })}><Plus className="size-4" /> Ajouter</Button>
        </Card>
      )}
      {classes.map((c) => (
        <Card key={c} className="divide-y p-0">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CLASS_LABEL[c]}</p>
          {shown.filter((a) => a.class === c).map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-16 shrink-0 text-sm font-medium tabular">{a.code}</span>
              {editing === a.id ? (
                <>
                  <Input className="h-8 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Libellé du compte ${a.code}`} />
                  <Button size="icon" variant="ghost" disabled={pending || draft.trim().length < 2} aria-label="Valider" onClick={() => update(a, { name: draft })}><Check className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Annuler" onClick={() => setEditing(null)}><X className="size-4" /></Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{a.name}{!a.isActive && <Badge variant="outline" className="ml-2">Désactivé</Badge>}</span>
                  {canManage && <Button size="icon" variant="ghost" aria-label={`Renommer ${a.code}`} onClick={() => { setEditing(a.id); setDraft(a.name); }}><Pencil className="size-4" /></Button>}
                  {canManage && <Switch checked={a.isActive} disabled={pending} aria-label={`Compte ${a.code} actif`} onCheckedChange={(v) => update(a, { isActive: v })} />}
                </>
              )}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

export interface MappingRow { key: string; label: string; expectedClass: number; accountId: string | null }

export function MappingsPanel({ mappings, accounts, canManage }: { mappings: MappingRow[]; accounts: AccountRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const change = (key: string, ledgerAccountId: string) => start(async () => { const r = await runAction(setMappingAction({ key, ledgerAccountId }), { success: "Correspondance enregistrée" }); if (r.ok) router.refresh(); });
  return (
    <Card className="divide-y p-0">
      <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comptes utilisés par les écritures automatiques</p>
      {mappings.map((m) => (
        <div key={m.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <span className="min-w-0 flex-1 text-sm">{m.label}</span>
          <Select value={m.accountId ?? undefined} disabled={!canManage || pending} onValueChange={(v) => change(m.key, v)}>
            <SelectTrigger className="w-80" aria-label={m.label}><SelectValue placeholder="Choisir un compte…" /></SelectTrigger>
            <SelectContent>{accounts.filter((a) => a.isActive && a.class === m.expectedClass).map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ))}
    </Card>
  );
}
