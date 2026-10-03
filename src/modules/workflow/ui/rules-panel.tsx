"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ActionButton } from "@/components/app/action-button";
import { Field, FormAlert } from "@/components/app/form-kit";
import { createRuleAction, deleteRuleAction, toggleRuleAction, updateRuleAction } from "../actions";
import { MAX_STEPS } from "../schemas";

export interface RuleRow {
  id: string; resourceType: string; name: string; minAmount: number; maxAmount: number | null; departmentId: string; requesterRoleId: string;
  priority: number; isActive: boolean; pending: number; steps: { label: string; roleId: string }[];
}
interface Option { id: string; name: string }
interface RoleOption extends Option { canApprove: boolean }

const NONE = "__none";
const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

type Draft = Omit<RuleRow, "id" | "pending" | "minAmount" | "maxAmount" | "priority"> & { minAmount: string; maxAmount: string; priority: string };
const emptyDraft = (type: string): Draft => ({ resourceType: type, name: "", minAmount: "0", maxAmount: "", departmentId: "", requesterRoleId: "", isActive: true, steps: [{ label: "Validation", roleId: "" }], priority: "100" });

function RuleDialog({ types, roles, departments, rule, trigger }: { types: { type: string; label: string }[]; roles: RoleOption[]; departments: Option[]; rule?: RuleRow; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = (): Draft => rule ? { ...rule, minAmount: String(rule.minAmount), maxAmount: rule.maxAmount === null ? "" : String(rule.maxAmount), priority: String(rule.priority) } : emptyDraft(types[0]!.type);
  const [f, setF] = useState<Draft>(init);
  const setStep = (i: number, patch: Partial<{ label: string; roleId: string }>) => setF({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, by: -1 | 1) => { const steps = [...f.steps]; const j = i + by; if (j < 0 || j >= steps.length) return; [steps[i], steps[j]] = [steps[j]!, steps[i]!]; setF({ ...f, steps }); };
  const isLeave = f.resourceType === "leave";

  const submit = () => start(async () => {
    setError(null);
    const payload = { resourceType: f.resourceType, name: f.name, minAmount: Number(f.minAmount || 0), maxAmount: f.maxAmount === "" ? "" as const : Number(f.maxAmount), departmentId: f.departmentId, requesterRoleId: f.requesterRoleId, priority: Number(f.priority || 100), isActive: f.isActive, steps: f.steps };
    const res = rule ? await updateRuleAction({ id: rule.id, ...payload }) : await createRuleAction(payload);
    if (!res.ok) return setError(errText(res.error));
    toast.success(rule ? "Règle mise à jour" : "Règle créée");
    setOpen(false); router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init()); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{rule ? "Modifier la règle" : "Nouvelle règle de validation"}</DialogTitle><DialogDescription>Définissez quand la règle s'applique, puis les étapes de validation dans l'ordre.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type d'opération">
              <Select value={f.resourceType} onValueChange={(v) => setF({ ...f, resourceType: v })}>
                <SelectTrigger className="w-full" aria-label="Type d'opération"><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Nom de la règle *" htmlFor="rule-name"><Input id="rule-name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex. Gros achats" /></Field>
            <Field label={isLeave ? "À partir de (jours, inclus)" : "À partir de (montant, inclus)"} htmlFor="rule-min"><Input id="rule-min" type="number" min={0} step="any" value={f.minAmount} onChange={(e) => setF({ ...f, minAmount: e.target.value })} /></Field>
            <Field label={isLeave ? "Jusqu'à (jours, exclu)" : "Jusqu'à (montant, exclu)"} htmlFor="rule-max" hint="Vide = sans limite."><Input id="rule-max" type="number" min={0} step="any" value={f.maxAmount} onChange={(e) => setF({ ...f, maxAmount: e.target.value })} /></Field>
            <Field label="Département du demandeur" hint="Vide = tous.">
              <Select value={f.departmentId || NONE} onValueChange={(v) => setF({ ...f, departmentId: v === NONE ? "" : v })}>
                <SelectTrigger className="w-full" aria-label="Département du demandeur"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Tous les départements</SelectItem>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Rôle du demandeur" hint="Vide = tous.">
              <Select value={f.requesterRoleId || NONE} onValueChange={(v) => setF({ ...f, requesterRoleId: v === NONE ? "" : v })}>
                <SelectTrigger className="w-full" aria-label="Rôle du demandeur"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Tous les rôles</SelectItem>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Priorité" htmlFor="rule-prio" hint="Si plusieurs règles conviennent, la plus haute priorité l'emporte."><Input id="rule-prio" type="number" min={0} max={1000} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
            <label className="mt-6 flex items-center gap-2 text-sm"><Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} /> Règle active</label>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Étapes de validation (dans l&apos;ordre)</legend>
            {f.steps.map((s, i) => (
              <div key={i} className="grid grid-cols-[1.5rem_1fr_1fr_auto] items-center gap-2">
                <span className="text-center text-sm text-muted-foreground">{i + 1}</span>
                <Input value={s.label} maxLength={60} aria-label={`Libellé de l'étape ${i + 1}`} onChange={(e) => setStep(i, { label: e.target.value })} placeholder="ex. Manager" />
                <Select value={s.roleId || NONE} onValueChange={(v) => setStep(i, { roleId: v === NONE ? "" : v })}>
                  <SelectTrigger className="w-full" aria-label={`Rôle validateur de l'étape ${i + 1}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>— Rôle validateur —</SelectItem>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.canApprove ? "" : " (sans droit de valider)"}</SelectItem>)}</SelectContent>
                </Select>
                <span className="flex">
                  <Button type="button" size="icon" variant="ghost" disabled={i === 0} aria-label={`Monter l'étape ${i + 1}`} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" disabled={i === f.steps.length - 1} aria-label={`Descendre l'étape ${i + 1}`} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" disabled={f.steps.length === 1} aria-label={`Supprimer l'étape ${i + 1}`} onClick={() => setF({ ...f, steps: f.steps.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
                </span>
              </div>
            ))}
            {f.steps.length < MAX_STEPS && <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setF({ ...f, steps: [...f.steps, { label: "", roleId: "" }] })}><Plus className="size-4" /> Ajouter une étape</Button>}
            <p className="text-xs text-muted-foreground">Une même personne ne peut valider qu&apos;une seule étape d&apos;une demande, et jamais sa propre demande. Les administrateurs peuvent valider n&apos;importe quelle étape.</p>
          </fieldset>
          <Button disabled={pending || !f.name.trim() || f.steps.some((s) => !s.label.trim() || !s.roleId)} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RulesPanel({ rules, types, roles, departments, canManage }: { rules: RuleRow[]; types: { type: string; label: string }[]; roles: RoleOption[]; departments: Option[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const label = (t: string) => types.find((x) => x.type === t)?.label ?? t;
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Rôle";
  const toggle = (r: RuleRow, isActive: boolean) => start(async () => { const res = await toggleRuleAction({ id: r.id, isActive }); if (!res.ok) toast.error(res.error.message); else router.refresh(); });

  return (
    <section className="max-w-3xl space-y-4" aria-labelledby="rules-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="rules-title" className="text-base font-semibold">Chaînes de validation</h2>
          <p className="text-sm text-muted-foreground">Selon le type d&apos;opération, le montant, le département et le rôle du demandeur : une suite d&apos;étapes (ex. Manager, puis Directeur financier). Une règle applicable remplace le seuil simple ci-dessus.</p>
        </div>
        {canManage && <RuleDialog types={types} roles={roles} departments={departments} trigger={<Button size="sm"><Plus className="size-4" /> Nouvelle règle</Button>} />}
      </div>
      {rules.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune règle : seuls les seuils simples ci-dessus s&apos;appliquent.</p> : (
        <Card className="divide-y p-0">
          {rules.map((r) => (
            <div key={r.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{r.name}</p>
                <Badge variant="outline">{label(r.resourceType)}</Badge>
                {!r.isActive && <Badge variant="secondary">Désactivée</Badge>}
                {r.pending > 0 && <Badge variant="secondary">{r.pending} en cours</Badge>}
                <span className="ml-auto flex items-center gap-1">
                  {canManage && <Switch checked={r.isActive} disabled={pending} aria-label={`Règle active : ${r.name}`} onCheckedChange={(v) => toggle(r, v)} />}
                  {canManage && <RuleDialog types={types} roles={roles} departments={departments} rule={r} trigger={<Button size="icon" variant="ghost" aria-label={`Modifier la règle ${r.name}`}><Pencil className="size-4" /></Button>} />}
                  {canManage && <ActionButton action={deleteRuleAction} input={{ id: r.id }} variant="ghost" size="icon" label="" ariaLabel={`Supprimer la règle ${r.name}`} icon={<Trash2 className="size-4" />} success="Règle supprimée" confirm={{ title: `Supprimer la règle « ${r.name} » ?`, confirmLabel: "Supprimer" }} />}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Montant de {r.minAmount.toLocaleString("fr-FR")}{r.maxAmount !== null ? ` à moins de ${r.maxAmount.toLocaleString("fr-FR")}` : " et plus"}
                {r.departmentId ? ` · département : ${departments.find((d) => d.id === r.departmentId)?.name ?? "—"}` : ""}
                {r.requesterRoleId ? ` · demandeur : ${roleName(r.requesterRoleId)}` : ""} · priorité {r.priority}
              </p>
              <ol className="flex flex-wrap items-center gap-1 text-sm" aria-label="Étapes">
                {r.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}
                    <span className="rounded-md bg-muted px-2 py-0.5">{s.label} <span className="text-muted-foreground">({roleName(s.roleId)}{roles.find((x) => x.id === s.roleId)?.canApprove === false ? " ⚠ sans droit de valider" : ""})</span></span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
