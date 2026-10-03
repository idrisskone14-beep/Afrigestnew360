"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/components/app/form-kit";
import { savePolicyAction } from "@/modules/workflow/actions";

interface PolicyRow { type: string; label: string; isEnabled: boolean; threshold: number; available: boolean }

export function PoliciesPanel({ policies, canManage, currency }: { policies: PolicyRow[]; canManage: boolean; currency: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState(() => Object.fromEntries(policies.map((p) => [p.type, { isEnabled: p.isEnabled, threshold: String(p.threshold) }])));
  const save = (type: string) => start(async () => {
    const s = state[type]!;
    const r = await runAction(savePolicyAction({ type, isEnabled: s.isEnabled, threshold: Number(s.threshold || 0) }), { success: "Règle enregistrée" });
    if (r.ok) router.refresh();
  });

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">Quand une règle est active, tout document dont le montant atteint le seuil doit être validé par une autre personne habilitée (jamais par son auteur) avant de poursuivre. Un seuil de 0 soumet tous les documents à validation.</p>
      <Card className="divide-y p-0">
        {policies.map((p) => {
          const s = state[p.type]!;
          return (
            <div key={p.type} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{p.label}</p>
                {!p.available && <p className="text-xs text-muted-foreground">Module non activé pour votre entreprise : la règle sera appliquée dès son activation.</p>}
              </div>
              <Switch checked={s.isEnabled} disabled={!canManage || pending} aria-label={`Validation obligatoire : ${p.label}`} onCheckedChange={(v) => setState({ ...state, [p.type]: { ...s, isEnabled: v } })} />
              <div className="flex items-center gap-2">
                <label htmlFor={`th-${p.type}`} className="text-xs text-muted-foreground">Seuil ({currency})</label>
                <Input id={`th-${p.type}`} type="number" min={0} step="any" className="h-9 w-32" value={s.threshold} disabled={!canManage || pending || !s.isEnabled} onChange={(e) => setState({ ...state, [p.type]: { ...s, threshold: e.target.value } })} />
              </div>
              {canManage && <Button size="sm" disabled={pending} onClick={() => save(p.type)}>Enregistrer</Button>}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
