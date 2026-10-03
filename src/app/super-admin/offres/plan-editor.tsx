"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Field, runAction } from "@/components/app/form-kit";
import { LIMIT_KEYS } from "@/core/modules/registry";
import { updatePlanAction } from "@/modules/platform/actions";

interface PlanData {
  id: string; code: string; name: string; description: string; priceMonthly: number; priceYearly: number; trialDays: number;
  isPublic: boolean; isActive: boolean; moduleKeys: string[]; limits: Record<string, number>;
}

export function PlanEditor({ plan, modules, subscribers }: { plan: PlanData; modules: { key: string; name: string; kind: string }[]; subscribers: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [monthly, setMonthly] = useState(String(plan.priceMonthly));
  const [yearly, setYearly] = useState(String(plan.priceYearly));
  const [trial, setTrial] = useState(String(plan.trialDays));
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [isActive, setIsActive] = useState(plan.isActive);
  const [keys, setKeys] = useState(new Set(plan.moduleKeys));
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries(LIMIT_KEYS.map((l) => [l.key, String(plan.limits[l.key] ?? -1)])));

  const save = () =>
    start(async () => {
      const res = await runAction(
        updatePlanAction({
          planId: plan.id, name, description, priceMonthly: Number(monthly), priceYearly: Number(yearly), trialDays: Number(trial),
          isPublic, isActive, moduleKeys: [...keys], limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, Number(v)])),
        }),
      );
      if (res.ok) { const n = res.data.affectedCompanies; toast.success(`Offre enregistrée · ${n} entreprise${n > 1 ? "s" : ""} synchronisée${n > 1 ? "s" : ""}`); router.refresh(); }
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">{plan.name} <Badge variant="outline" className="font-mono text-[10px]">{plan.code}</Badge></CardTitle>
          <CardDescription className="mt-1">{subscribers} entreprise{subscribers > 1 ? "s" : ""} abonnée{subscribers > 1 ? "s" : ""}</CardDescription>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">Publique <Switch checked={isPublic} onCheckedChange={setIsPublic} /></label>
          <label className="flex items-center gap-2">Active <Switch checked={isActive} onCheckedChange={setIsActive} /></label>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Nom" htmlFor={`n-${plan.id}`}><Input id={`n-${plan.id}`} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Prix mensuel" htmlFor={`m-${plan.id}`}><Input id={`m-${plan.id}`} type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
          <Field label="Prix annuel" htmlFor={`y-${plan.id}`}><Input id={`y-${plan.id}`} type="number" min={0} value={yearly} onChange={(e) => setYearly(e.target.value)} /></Field>
          <Field label="Essai (jours)" htmlFor={`t-${plan.id}`}><Input id={`t-${plan.id}`} type="number" min={0} value={trial} onChange={(e) => setTrial(e.target.value)} /></Field>
          <Field label="Description" htmlFor={`d-${plan.id}`} className="sm:col-span-4"><Input id={`d-${plan.id}`} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Modules inclus <span className="font-normal text-muted-foreground">(le cœur est toujours inclus)</span></p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-sm">
                <Checkbox checked={keys.has(m.key)} onCheckedChange={(v) => setKeys((prev) => { const n = new Set(prev); if (v === true) n.add(m.key); else n.delete(m.key); return n; })} />
                {m.name} {m.kind === "EXTENSION" && <Badge variant="outline">Extension</Badge>}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Limites <span className="font-normal text-muted-foreground">(-1 = illimité)</span></p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LIMIT_KEYS.map((l) => (
              <Field key={l.key} label={l.label} htmlFor={`l-${plan.id}-${l.key}`}>
                <Input id={`l-${plan.id}-${l.key}`} type="number" min={-1} value={limits[l.key]} onChange={(e) => setLimits((p) => ({ ...p, [l.key]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </div>
        <Button disabled={pending} onClick={save}>Enregistrer l'offre</Button>
      </CardContent>
    </Card>
  );
}
