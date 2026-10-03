"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runAction } from "@/components/app/form-kit";
import { createStageAction, deleteStageAction, moveStageAction, updateStageAction } from "../actions";

interface StageRow { id: string; name: string; probability: number; kind: "OPEN" | "WON" | "LOST"; opportunities: number }
const KIND: Record<string, string> = { OPEN: "En cours", WON: "Gagnée", LOST: "Perdue" };

export function PipelineSettings({ stages }: { stages: StageRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Partial<StageRow>>>({});
  const [nw, setNw] = useState({ name: "", probability: "50", kind: "OPEN" as StageRow["kind"] });
  const val = <K extends keyof StageRow>(s: StageRow, k: K): StageRow[K] => (drafts[s.id]?.[k] ?? s[k]) as StageRow[K];
  const patch = (id: string, p: Partial<StageRow>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  const refresh = (ok: boolean) => { if (ok) router.refresh(); };

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">Les étapes s'affichent dans cet ordre sur le tableau des opportunités. Le pipeline doit garder au moins une étape en cours, une gagnée et une perdue.</p>
      <Card className="divide-y p-0">
        {stages.map((s, i) => {
          const dirty = drafts[s.id] !== undefined;
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2 p-3">
              <div className="flex flex-col">
                <Button variant="ghost" size="icon" className="size-6" disabled={i === 0 || pending} aria-label="Monter" onClick={() => start(async () => refresh((await runAction(moveStageAction({ id: s.id, direction: "up" }))).ok))}><ArrowUp className="size-3.5" /></Button>
                <Button variant="ghost" size="icon" className="size-6" disabled={i === stages.length - 1 || pending} aria-label="Descendre" onClick={() => start(async () => refresh((await runAction(moveStageAction({ id: s.id, direction: "down" }))).ok))}><ArrowDown className="size-3.5" /></Button>
              </div>
              <Input className="h-9 w-48" value={val(s, "name")} onChange={(e) => patch(s.id, { name: e.target.value })} aria-label="Nom de l'étape" />
              <Select value={val(s, "kind")} onValueChange={(v) => patch(s.id, { kind: v as StageRow["kind"] })}>
                <SelectTrigger className="h-9 w-32" aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(KIND).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">Probabilité <Input type="number" min={0} max={100} className="h-9 w-20" value={val(s, "probability")} onChange={(e) => patch(s.id, { probability: Number(e.target.value) })} />%</label>
              <span className="ml-auto text-xs text-muted-foreground">{s.opportunities} opp.</span>
              {dirty && <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await runAction(updateStageAction({ id: s.id, name: val(s, "name"), probability: val(s, "probability"), kind: val(s, "kind") }), { success: "Étape mise à jour" }); if (r.ok) { setDrafts((d) => { const n = { ...d }; delete n[s.id]; return n; }); router.refresh(); } })}>Enregistrer</Button>}
              <Button variant="ghost" size="icon" aria-label={`Supprimer ${s.name}`} disabled={pending} onClick={() => start(async () => refresh((await runAction(deleteStageAction({ id: s.id }), { success: "Étape supprimée" })).ok))}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          );
        })}
      </Card>
      <Card className="flex flex-wrap items-end gap-2 p-3">
        <div className="grid gap-1"><label className="text-xs text-muted-foreground" htmlFor="ns-name">Nouvelle étape</label><Input id="ns-name" className="h-9 w-48" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="ex. Signature" /></div>
        <Select value={nw.kind} onValueChange={(v) => setNw({ ...nw, kind: v as StageRow["kind"] })}>
          <SelectTrigger className="h-9 w-32" aria-label="Type"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(KIND).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" min={0} max={100} className="h-9 w-20" value={nw.probability} onChange={(e) => setNw({ ...nw, probability: e.target.value })} aria-label="Probabilité" />
        <Button disabled={pending || nw.name.trim().length < 2} onClick={() => start(async () => { const r = await runAction(createStageAction({ name: nw.name, probability: Number(nw.probability), kind: nw.kind }), { success: "Étape ajoutée" }); if (r.ok) { setNw({ ...nw, name: "" }); router.refresh(); } })}><Plus className="size-4" /> Ajouter</Button>
      </Card>
    </div>
  );
}
