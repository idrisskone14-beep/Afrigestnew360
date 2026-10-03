"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/components/app/form-kit";
import { createTaxAction, updateTaxAction } from "@/modules/settings/config-actions";

interface TaxRow { id: string; name: string; rate: number; isDefault: boolean; isActive: boolean }

export function TaxesPanel({ taxes, canManage }: { taxes: TaxRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const save = (t: TaxRow, patch: Partial<TaxRow>) => start(async () => { const m = { ...t, ...patch }; const r = await runAction(updateTaxAction({ id: t.id, name: m.name, rate: m.rate, isDefault: m.isDefault, isActive: m.isActive }), { success: "Taxe mise à jour" }); if (r.ok) router.refresh(); });

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">Les taux sont configurables : aucun taux n'est codé en dur. Les valeurs proposées à la création sont indicatives — vérifiez-les auprès de votre administration fiscale.</p>
      <Card className="divide-y p-0">
        {taxes.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">{t.name}{t.isDefault && <Badge variant="secondary">Par défaut</Badge>}{!t.isActive && <Badge variant="outline">Désactivée</Badge>}</p>
              <p className="text-xs text-muted-foreground tabular">{t.rate} %</p>
            </div>
            {canManage && (
              <>
                {!t.isDefault && t.isActive && <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(t, { isDefault: true })}>Définir par défaut</Button>}
                <Switch checked={t.isActive} disabled={pending || t.isDefault} aria-label={`Taxe ${t.name} active`} onCheckedChange={(v) => save(t, { isActive: v })} />
              </>
            )}
          </div>
        ))}
      </Card>
      {canManage && (
        <Card className="flex flex-wrap items-end gap-2 p-3">
          <div className="grid gap-1"><label htmlFor="tx-name" className="text-xs text-muted-foreground">Nouvelle taxe</label><Input id="tx-name" className="h-9 w-56" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. TVA réduite" /></div>
          <div className="grid gap-1"><label htmlFor="tx-rate" className="text-xs text-muted-foreground">Taux (%)</label><Input id="tx-rate" type="number" min={0} max={100} step="0.01" className="h-9 w-24" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <Button disabled={pending || name.trim().length < 2 || rate === ""} onClick={() => start(async () => { const r = await runAction(createTaxAction({ name, rate: Number(rate), isDefault: false }), { success: "Taxe ajoutée" }); if (r.ok) { setName(""); setRate(""); router.refresh(); } })}><Plus className="size-4" /> Ajouter</Button>
        </Card>
      )}
    </div>
  );
}
