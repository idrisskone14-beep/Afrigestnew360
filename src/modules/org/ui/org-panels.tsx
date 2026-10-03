"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field, FormAlert } from "@/components/app/form-kit";
import type { ActionResult } from "@/core/errors";
import {
  createBranchAction, createCostCenterAction, createDepartmentAction, createSiteAction, updateBranchAction, updateCostCenterAction, updateDepartmentAction, updateSiteAction,
} from "../actions";

type Values = Record<string, string | boolean>;
interface FieldDef { name: string; label: string; kind?: "text" | "select" | "switch"; options?: { value: string; label: string }[]; required?: boolean; hint?: string; placeholder?: string }

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);
const NONE = "__none";

/** Boîte de dialogue de saisie pilotée par une liste de champs (création et modification d'un élément d'organisation). */
function EntityDialog({ title, description, fields, initial, trigger, onSubmit }: {
  title: string; description?: string; fields: FieldDef[]; initial: Values; trigger: React.ReactNode; onSubmit: (v: Values) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Values>(initial);
  const submit = () => start(async () => {
    setError(null);
    const res = await onSubmit(v);
    if (!res.ok) return setError(errText(res.error));
    toast.success("Enregistré");
    setOpen(false); router.refresh();
  });
  const missing = fields.some((f) => f.required && !String(v[f.name] ?? "").trim());
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setV(initial); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          {fields.map((f) => f.kind === "switch" ? (
            <label key={f.name} className="flex items-center gap-2 text-sm"><Switch checked={Boolean(v[f.name])} onCheckedChange={(c) => setV({ ...v, [f.name]: c })} /> {f.label}</label>
          ) : f.kind === "select" ? (
            <Field key={f.name} label={f.label}>
              <Select value={String(v[f.name] || NONE)} onValueChange={(x) => setV({ ...v, [f.name]: x === NONE ? "" : x })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>— Aucun —</SelectItem>{f.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : (
            <Field key={f.name} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`org-${f.name}`} hint={f.hint}><Input id={`org-${f.name}`} value={String(v[f.name] ?? "")} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} /></Field>
          ))}
          <Button disabled={pending || missing} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const AddButton = ({ label }: { label: string }) => <Button size="sm"><Plus className="size-4" /> {label}</Button>;
const EditButton = ({ label }: { label: string }) => <Button size="icon" variant="ghost" aria-label={label}><Pencil className="size-4" /></Button>;
const Status = ({ active }: { active: boolean }) => (active ? null : <Badge variant="outline" className="ml-2">Désactivé</Badge>);

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold">{title}</h3>{hint && <p className="mr-auto text-xs text-muted-foreground">{hint}</p>}{action}</div>
      <Card className="divide-y p-0">{children}</Card>
    </section>
  );
}
const Empty = ({ text }: { text: string }) => <p className="px-4 py-6 text-sm text-muted-foreground">{text}</p>;

export interface BranchRow { id: string; name: string; code: string; address: string; city: string; isHeadquarters: boolean; isActive: boolean }
export interface SiteRow { id: string; name: string; type: string; address: string; branchId: string; branchName: string; isActive: boolean }
export interface DepartmentRow { id: string; name: string; code: string; parentId: string; isActive: boolean }
export interface CostCenterRow { id: string; code: string; name: string; isActive: boolean }

export function OrgPanels({ branches, sites, departments, costCenters, canManage }: { branches: BranchRow[]; sites: SiteRow[]; departments: DepartmentRow[]; costCenters: CostCenterRow[]; canManage: boolean }) {
  const branchOpts = branches.filter((b) => b.isActive).map((b) => ({ value: b.id, label: b.name }));
  const depName = new Map(departments.map((d) => [d.id, d.name]));
  const branchFields: FieldDef[] = [
    { name: "name", label: "Nom", required: true }, { name: "code", label: "Code", hint: "Court et unique (ex. ABJ)" }, { name: "address", label: "Adresse" }, { name: "city", label: "Ville" },
    { name: "isHeadquarters", label: "Siège de l'entreprise", kind: "switch" },
  ];
  const siteFields: FieldDef[] = [
    { name: "name", label: "Nom", required: true }, { name: "type", label: "Type", placeholder: "dépôt, chantier, bureau…" }, { name: "address", label: "Adresse" }, { name: "branchId", label: "Agence de rattachement", kind: "select", options: branchOpts },
  ];
  const depFields = (self?: string): FieldDef[] => [
    { name: "name", label: "Nom", required: true }, { name: "code", label: "Code" },
    { name: "parentId", label: "Département parent", kind: "select", options: departments.filter((d) => d.isActive && d.id !== self).map((d) => ({ value: d.id, label: d.name })) },
  ];
  const ccFields: FieldDef[] = [{ name: "code", label: "Code", required: true, hint: "Ex. COM, PROD, ADM" }, { name: "name", label: "Libellé", required: true }];
  const withActive = (fields: FieldDef[]): FieldDef[] => [...fields, { name: "isActive", label: "Actif", kind: "switch" }];

  return (
    <div className="space-y-8">
      <Section title="Agences" hint="Sièges et points de vente ; servent à ventiler factures et dépenses." action={canManage ? <EntityDialog title="Nouvelle agence" fields={branchFields} initial={{ name: "", code: "", address: "", city: "", isHeadquarters: false }} trigger={<AddButton label="Agence" />} onSubmit={(v) => createBranchAction(v as never)} /> : undefined}>
        {branches.length === 0 && <Empty text="Aucune agence." />}
        {branches.map((b) => (
          <div key={b.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{b.name}{b.code && <span className="ml-2 text-xs font-normal text-muted-foreground">{b.code}</span>}{b.isHeadquarters && <Badge variant="secondary" className="ml-2">Siège</Badge>}<Status active={b.isActive} /></p><p className="truncate text-xs text-muted-foreground">{[b.address, b.city].filter(Boolean).join(", ") || "—"}</p></div>
            {canManage && <EntityDialog title="Modifier l'agence" fields={withActive(branchFields)} initial={{ ...b }} trigger={<EditButton label={`Modifier ${b.name}`} />} onSubmit={(v) => updateBranchAction({ ...(v as Record<string, unknown>), id: b.id } as never)} />}
          </div>
        ))}
      </Section>

      <Section title="Sites" hint="Dépôts, bureaux, chantiers rattachés à une agence." action={canManage ? <EntityDialog title="Nouveau site" fields={siteFields} initial={{ name: "", type: "", address: "", branchId: "" }} trigger={<AddButton label="Site" />} onSubmit={(v) => createSiteAction(v as never)} /> : undefined}>
        {sites.length === 0 && <Empty text="Aucun site." />}
        {sites.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{s.name}{s.type && <span className="ml-2 text-xs font-normal text-muted-foreground">{s.type}</span>}<Status active={s.isActive} /></p><p className="truncate text-xs text-muted-foreground">{[s.branchName, s.address].filter(Boolean).join(" · ") || "—"}</p></div>
            {canManage && <EntityDialog title="Modifier le site" fields={withActive(siteFields)} initial={{ ...s }} trigger={<EditButton label={`Modifier ${s.name}`} />} onSubmit={(v) => updateSiteAction({ ...(v as Record<string, unknown>), id: s.id } as never)} />}
          </div>
        ))}
      </Section>

      <Section title="Départements" hint="Organigramme : un département peut dépendre d'un autre." action={canManage ? <EntityDialog title="Nouveau département" fields={depFields()} initial={{ name: "", code: "", parentId: "" }} trigger={<AddButton label="Département" />} onSubmit={(v) => createDepartmentAction(v as never)} /> : undefined}>
        {departments.length === 0 && <Empty text="Aucun département." />}
        {departments.map((dep) => (
          <div key={dep.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{dep.name}{dep.code && <span className="ml-2 text-xs font-normal text-muted-foreground">{dep.code}</span>}<Status active={dep.isActive} /></p>{dep.parentId && <p className="truncate text-xs text-muted-foreground">Dépend de {depName.get(dep.parentId) ?? "—"}</p>}</div>
            {canManage && <EntityDialog title="Modifier le département" fields={withActive(depFields(dep.id))} initial={{ ...dep }} trigger={<EditButton label={`Modifier ${dep.name}`} />} onSubmit={(v) => updateDepartmentAction({ ...(v as Record<string, unknown>), id: dep.id } as never)} />}
          </div>
        ))}
      </Section>

      <Section title="Centres de coûts" hint="Axes d'analyse des charges et produits (factures, dépenses)." action={canManage ? <EntityDialog title="Nouveau centre de coûts" fields={ccFields} initial={{ code: "", name: "" }} trigger={<AddButton label="Centre de coûts" />} onSubmit={(v) => createCostCenterAction(v as never)} /> : undefined}>
        {costCenters.length === 0 && <Empty text="Aucun centre de coûts." />}
        {costCenters.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
            <p className="min-w-0 flex-1 truncate text-sm"><span className="font-medium">{c.code}</span> <span className="text-muted-foreground">— {c.name}</span><Status active={c.isActive} /></p>
            {canManage && <EntityDialog title="Modifier le centre de coûts" fields={withActive(ccFields)} initial={{ ...c }} trigger={<EditButton label={`Modifier ${c.code}`} />} onSubmit={(v) => updateCostCenterAction({ ...(v as Record<string, unknown>), id: c.id } as never)} />}
          </div>
        ))}
      </Section>
    </div>
  );
}
