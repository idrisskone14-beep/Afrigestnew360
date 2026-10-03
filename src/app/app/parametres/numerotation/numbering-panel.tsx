"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { runAction } from "@/components/app/form-kit";
import { updateNumberingAction } from "@/modules/settings/config-actions";

interface Row { key: string; label: string; prefix: string; padding: number; withYear: boolean; resetYearly: boolean; last: number; next: string }

function preview(r: Pick<Row, "prefix" | "padding" | "withYear">, seq: number) {
  return [r.prefix, ...(r.withYear ? [new Date().getFullYear()] : []), String(seq).padStart(r.padding, "0")].join("-");
}

export function NumberingPanel({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Partial<Row>>>({});
  const get = (r: Row): Row => ({ ...r, ...drafts[r.key] });
  const patch = (k: string, p: Partial<Row>) => setDrafts((d) => ({ ...d, [k]: { ...d[k], ...p } }));

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-muted-foreground">Format des numéros de vos documents. Les compteurs sont atomiques : deux utilisateurs ne peuvent jamais obtenir le même numéro. Modifier le format n'altère pas les numéros déjà émis.</p>
      <Card className="divide-y p-0">
        {rows.map((r0) => {
          const r = get(r0);
          return (
            <div key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="w-48"><p className="text-sm font-medium">{r.label}</p><p className="text-xs text-muted-foreground">Dernier n° émis : {r.last}</p></div>
              <Input className="h-9 w-24" value={r.prefix} disabled={!canManage} aria-label={`Préfixe ${r.label}`} onChange={(e) => patch(r.key, { prefix: e.target.value.toUpperCase() })} />
              <Input type="number" min={1} max={10} className="h-9 w-20" value={r.padding} disabled={!canManage} aria-label={`Chiffres ${r.label}`} onChange={(e) => patch(r.key, { padding: Number(e.target.value) })} />
              <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={r.withYear} disabled={!canManage} onCheckedChange={(v) => patch(r.key, { withYear: v === true })} /> Année</label>
              <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={r.resetYearly} disabled={!canManage} onCheckedChange={(v) => patch(r.key, { resetYearly: v === true })} /> Remise à zéro annuelle</label>
              <code className="ml-auto rounded bg-muted px-2 py-1 text-xs">{drafts[r.key] ? preview(r, r.last + 1) : r.next}</code>
              {canManage && drafts[r.key] && (
                <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await runAction(updateNumberingAction({ key: r.key, prefix: r.prefix, padding: r.padding, withYear: r.withYear, resetYearly: r.resetYearly }), { success: "Numérotation mise à jour" }); if (x.ok) { setDrafts((d) => { const n = { ...d }; delete n[r.key]; return n; }); router.refresh(); } })}>Enregistrer</Button>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
