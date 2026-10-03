"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { d } from "@/core/money";
import { formatMoney } from "@/lib/reference-data";
import { createRequestAction, updateRequestAction } from "../actions";

export interface RequestProductOpt { id: string; name: string; sku: string; unit: string; costPrice: number }
interface LineState { key: number; productId: string; description: string; unit: string; quantity: string; estimatedPrice: string }
export interface RequestInitial { neededBy: string; reason: string; lines: { productId: string; description: string; unit: string; quantity: number; estimatedPrice: number }[] }

const FREE = "free";

export function RequestEditor({ id, initial, products, currency }: { id?: string; initial: RequestInitial; products: RequestProductOpt[]; currency: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ neededBy: initial.neededBy, reason: initial.reason });
  const blank = (key: number): LineState => ({ key, productId: "", description: "", unit: "unité", quantity: "1", estimatedPrice: "" });
  const [lines, setLines] = useState<LineState[]>(() => (initial.lines.length ? initial.lines.map((l, i) => ({ key: i, productId: l.productId, description: l.description, unit: l.unit, quantity: String(l.quantity), estimatedPrice: String(l.estimatedPrice) })) : [blank(0)]));
  const [nextKey, setNextKey] = useState(initial.lines.length || 1);
  const patch = (key: number, p: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const pick = (key: number, productId: string) => {
    if (productId === FREE) return patch(key, { productId: "" });
    const p = products.find((x) => x.id === productId);
    if (p) patch(key, { productId, description: p.name, unit: p.unit, estimatedPrice: String(p.costPrice) });
  };
  const estimate = lines.reduce((a, l) => a.plus(d(Number(l.quantity) || 0).mul(Number(l.estimatedPrice) || 0)), d(0)).toNumber();
  const valid = lines.every((l) => l.description.trim() && Number(l.quantity) > 0);

  const submit = () => start(async () => {
    setError(null);
    const payload = { neededBy: f.neededBy, reason: f.reason, lines: lines.map((l) => ({ productId: l.productId, description: l.description, unit: l.unit, quantity: Number(l.quantity), estimatedPrice: Number(l.estimatedPrice || 0) })) };
    const res = id ? await updateRequestAction({ ...payload, id }) : await createRequestAction(payload);
    if (!res.ok) {
      const fe = res.error.fieldErrors ? Object.entries(res.error.fieldErrors).map(([k, v]) => `${k.replace(/^lines\.(\d+)\./, "Ligne $1 : ")} ${v[0]}`)[0] : null;
      return setError(fe ?? res.error.message);
    }
    toast.success(id ? "Enregistré" : "Demande créée");
    router.push(`/app/purchases/demandes/${id ?? (res.data as { id: string }).id}`);
    router.refresh();
  });

  return (
    <div className="space-y-6">
      <FormAlert message={error} />
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Besoin pour le" htmlFor="rq-date"><Input id="rq-date" type="date" value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></Field>
          <Field label="Motif de la demande" htmlFor="rq-reason" className="sm:col-span-2"><Input id="rq-reason" value={f.reason} placeholder="Réapprovisionnement, nouveau projet…" onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <section aria-label="Articles demandés" className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Articles demandés</h3>
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-2 rounded-lg border bg-card p-3 lg:grid-cols-[minmax(10rem,1.1fr)_minmax(12rem,2fr)_5rem_5.5rem_8rem_2rem] lg:items-start lg:border-0 lg:bg-transparent lg:p-0">
            <Select value={l.productId || FREE} onValueChange={(v) => pick(l.key, v)}>
              <SelectTrigger className="w-full" aria-label={`Produit ligne ${i + 1}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={FREE}>— Article libre —</SelectItem>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>)}</SelectContent>
            </Select>
            <Input value={l.description} placeholder="Désignation" aria-label={`Désignation ligne ${i + 1}`} onChange={(e) => patch(l.key, { description: e.target.value })} />
            <Input type="number" min={0} step="any" value={l.quantity} aria-label={`Quantité ligne ${i + 1}`} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
            <Input value={l.unit} aria-label={`Unité ligne ${i + 1}`} onChange={(e) => patch(l.key, { unit: e.target.value })} />
            <Input type="number" min={0} step="any" value={l.estimatedPrice} placeholder="Prix estimé" aria-label={`Prix estimé ligne ${i + 1}`} onChange={(e) => patch(l.key, { estimatedPrice: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Supprimer la ligne ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-muted-foreground" /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => { setLines((ls) => [...ls, blank(nextKey)]); setNextKey((k) => k + 1); }}><Plus className="size-4" /> Ajouter une ligne</Button>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" aria-live="polite"><span className="text-muted-foreground">Estimation totale :</span> <span className="font-semibold tabular">{formatMoney(estimate, currency)}</span></p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push(id ? `/app/purchases/demandes/${id}` : "/app/purchases/demandes")} disabled={pending}>Annuler</Button>
          <Button onClick={submit} disabled={pending || !valid}>{id ? "Enregistrer" : "Créer la demande"}</Button>
        </div>
      </div>
    </div>
  );
}
