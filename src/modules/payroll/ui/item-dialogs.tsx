"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field, FormAlert, runAction } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { addEmployeeItemAction, installSampleItemsAction, saveItemAction, toggleItemAction } from "../actions";
import { BASES, CATEGORIES, ITEM_TYPES, MODES } from "../schemas";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

export interface ItemInit {
  code: string; name: string; type: string; category: string; mode: string; base: string; value: number; ceiling: number | null; brackets: { upTo: number | null; rate: number }[];
  taxable: boolean; deductibleForTax: boolean; sortOrder: number; effectiveFrom: string;
}
const BLANK: ItemInit = { code: "", name: "", type: "DEDUCTION", category: "SOCIAL", mode: "RATE", base: "GROSS", value: 0, ceiling: null, brackets: [{ upTo: 100000, rate: 0 }, { upTo: null, rate: 10 }], taxable: true, deductibleForTax: false, sortOrder: 100, effectiveFrom: todayInput() };

export function ItemDialog({ item, trigger }: { item?: ItemInit; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = item ?? BLANK;
  const [f, setF] = useState<ItemInit>(init);
  const set = <K extends keyof ItemInit>(k: K, v: ItemInit[K]) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => start(async () => {
    setError(null);
    const res = await saveItemAction({ ...f, ceiling: f.ceiling ?? "", brackets: f.mode === "BRACKETS" ? f.brackets : undefined } as never);
    if (!res.ok) return setError(errText(res.error));
    toast.success("Rubrique enregistrée"); setOpen(false); router.refresh();
  });
  const earning = f.type === "EARNING";
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus className="size-4" /> Nouvelle rubrique</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{item ? "Nouvelle version de la rubrique" : "Nouvelle rubrique"}</DialogTitle><DialogDescription>Une nouvelle date d'effet crée une version : les campagnes déjà calculées ne changent pas. Saisissez les taux de VOTRE pays et de VOTRE convention.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Code *" htmlFor="pi-code"><Input id="pi-code" value={f.code} disabled={Boolean(item)} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="RETRAITE_S" /></Field>
          <Field label="Libellé *" htmlFor="pi-name"><Input id="pi-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Type"><Select value={f.type} onValueChange={(v) => setF((s) => ({ ...s, type: v, category: v === "EARNING" ? "OTHER" : s.category === "OTHER" && v === "DEDUCTION" ? "SOCIAL" : s.category, mode: v === "EARNING" && s.mode === "BRACKETS" ? "FIXED" : s.mode, base: v === "EARNING" ? "BASE" : s.base }))} disabled={Boolean(item)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{ITEM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent></Select></Field>
          {!earning && <Field label="Catégorie (comptabilité)"><Select value={f.category} onValueChange={(v) => set("category", v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.filter((c) => f.type !== "EMPLOYER" || c.value !== "TAX").map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></Field>}
          <Field label="Mode de calcul"><Select value={f.mode} onValueChange={(v) => set("mode", v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{MODES.filter((m) => !earning || m.value !== "BRACKETS").map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent></Select></Field>
          {f.mode !== "FIXED" && !earning && <Field label="Assiette"><Select value={f.base} onValueChange={(v) => set("base", v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent></Select></Field>}
          {f.mode === "FIXED" && <Field label="Montant mensuel" htmlFor="pi-val"><Input id="pi-val" type="number" min={0} step="any" value={f.value} onChange={(e) => set("value", Number(e.target.value))} /></Field>}
          {f.mode === "RATE" && <Field label="Taux (%)" htmlFor="pi-rate"><Input id="pi-rate" type="number" min={0} max={100} step="any" value={f.value} onChange={(e) => set("value", Number(e.target.value))} /></Field>}
          {f.mode === "RATE" && !earning && <Field label="Plafond de l'assiette" htmlFor="pi-ceil" hint="Vide = sans plafond"><Input id="pi-ceil" type="number" min={0} step="any" value={f.ceiling ?? ""} onChange={(e) => set("ceiling", e.target.value ? Number(e.target.value) : null)} /></Field>}
          {f.mode === "BRACKETS" && (
            <div className="grid gap-2 sm:col-span-2">
              <p className="text-sm font-medium">Tranches (taux marginal sur la part de l'assiette comprise dans la tranche)</p>
              {f.brackets.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-20 text-xs text-muted-foreground">Jusqu'à</span>
                  <Input type="number" min={0} className="h-9 w-36" aria-label={`Plafond de la tranche ${i + 1}`} placeholder="sans limite" value={b.upTo ?? ""} onChange={(e) => set("brackets", f.brackets.map((x, j) => (j === i ? { ...x, upTo: e.target.value ? Number(e.target.value) : null } : x)))} />
                  <span className="text-xs text-muted-foreground">taux %</span>
                  <Input type="number" min={0} max={100} step="any" className="h-9 w-24" aria-label={`Taux de la tranche ${i + 1}`} value={b.rate} onChange={(e) => set("brackets", f.brackets.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)))} />
                  <Button type="button" size="icon" variant="ghost" aria-label={`Supprimer la tranche ${i + 1}`} disabled={f.brackets.length <= 1} onClick={() => set("brackets", f.brackets.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => set("brackets", [...f.brackets.slice(0, -1), { upTo: ((f.brackets.at(-2)?.upTo ?? 0) || 0) + 100000, rate: 0 }, f.brackets.at(-1)!])}><Plus className="size-4" /> Ajouter une tranche</Button>
            </div>
          )}
          {earning ? <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.taxable} onCheckedChange={(v) => set("taxable", v)} /> Entre dans l'assiette imposable</label>
            : f.type === "DEDUCTION" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.deductibleForTax} onCheckedChange={(v) => set("deductibleForTax", v)} /> Déductible de l'assiette imposable (cotisation obligatoire)</label>}
          <Field label="Ordre de calcul" htmlFor="pi-order" hint="Placez l'impôt APRÈS les cotisations déductibles"><Input id="pi-order" type="number" min={0} value={f.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} /></Field>
          <Field label="Date d'effet" htmlFor="pi-from"><Input id="pi-from" type="date" value={f.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} /></Field>
          <Button className="sm:col-span-2" disabled={pending || f.code.trim().length < 2 || f.name.trim().length < 2} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ItemActiveSwitch({ id, isActive, label }: { id: string; isActive: boolean; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Switch checked={isActive} disabled={pending} aria-label={label} onCheckedChange={(v) => start(async () => { const r = await runAction(toggleItemAction({ id, isActive: v }), { success: v ? "Rubrique activée" : "Rubrique désactivée" }); if (r.ok) router.refresh(); })} />;
}

export function SampleItemsButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await runAction(installSampleItemsAction({}), { success: "Modèle indicatif chargé : remplacez ses taux d'exemple" }); if (r.ok) router.refresh(); })}>
      <Sparkles className="size-4" /> Charger un modèle indicatif
    </Button>
  );
}

export function EmployeeItemDialog({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { name: "", type: "EARNING", category: "OTHER", amount: "", taxable: true, startDate: todayInput(), endDate: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const res = await addEmployeeItemAction({ employeeId, name: f.name, type: f.type as "EARNING", category: f.type === "EARNING" ? "OTHER" : (f.category as "OTHER"), amount: Number(f.amount), taxable: f.taxable, startDate: f.startDate, endDate: f.endDate });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Élément ajouté"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Prime ou retenue</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Prime ou retenue récurrente</DialogTitle><DialogDescription>Montant mensuel ajouté (ou retenu) sur chaque bulletin de la période.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Libellé *" htmlFor="ei-name" className="sm:col-span-2"><Input id="ei-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Prime de panier, remboursement d'avance…" /></Field>
          <Field label="Nature"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EARNING">Prime (gain)</SelectItem><SelectItem value="DEDUCTION">Retenue</SelectItem></SelectContent></Select></Field>
          <Field label="Montant mensuel *" htmlFor="ei-amount"><Input id="ei-amount" type="number" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Début" htmlFor="ei-start"><Input id="ei-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Fin" htmlFor="ei-end" hint="Vide = sans limite"><Input id="ei-end" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          {f.type === "EARNING" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={f.taxable} onCheckedChange={(v) => setF({ ...f, taxable: v })} /> Entre dans l'assiette imposable</label>}
          {f.type === "DEDUCTION" && <Field label="Catégorie (comptabilité)" className="sm:col-span-2"><Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></Field>}
          <Button className="sm:col-span-2" disabled={pending || f.name.trim().length < 2 || !(Number(f.amount) > 0)} onClick={submit}>Ajouter</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
