"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { formatMoney } from "@/lib/reference-data";
import { createPriceListAction, setPriceListItemsAction, updatePriceListAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

export function NewPriceListDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const submit = () => start(async () => {
    setError(null);
    const res = await createPriceListAction({ name, description, isActive: true });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Liste créée : ajoutez maintenant ses prix");
    setOpen(false);
    router.push(`/app/sales/listes-de-prix/${res.data.id}`);
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setName(""); setDescription(""); } }}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> Nouvelle liste</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle liste de prix</DialogTitle><DialogDescription>Par exemple « Grossistes », « Revendeurs » ou « Contrat-cadre 2026 ».</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Nom *" htmlFor="pl-name"><Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Description" htmlFor="pl-desc"><Input id="pl-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Button disabled={pending || name.trim().length < 2} onClick={submit}>{pending ? "Création…" : "Créer la liste"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ProductOpt { id: string; name: string; sku: string; unit: string; salePrice: number }

/** Tableau des prix d'une liste : un prix par produit (absent = prix standard), enregistré en une fois. */
export function PriceListEditor({ id, name, description, isActive, currency, products, initial }: {
  id: string; name: string; description: string; isActive: boolean; currency: string; products: ProductOpt[]; initial: { productId: string; price: number }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState({ name, description, isActive });
  const [rows, setRows] = useState(initial.map((r) => ({ productId: r.productId, price: String(r.price) })));
  const [adding, setAdding] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const available = products.filter((p) => !rows.some((r) => r.productId === p.id));

  const save = () => start(async () => {
    setError(null);
    const m = await updatePriceListAction({ id, ...meta });
    if (!m.ok) return setError(errText(m.error));
    const res = await setPriceListItemsAction({ id, items: rows.map((r) => ({ productId: r.productId, price: Number(r.price) || 0 })) });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Liste de prix enregistrée");
    router.refresh();
  });

  return (
    <div className="space-y-5">
      <FormAlert message={error} />
      <div className="grid gap-4 sm:grid-cols-[2fr_3fr_auto] sm:items-end">
        <Field label="Nom *" htmlFor="ple-name"><Input id="ple-name" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
        <Field label="Description" htmlFor="ple-desc"><Input id="ple-desc" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
        <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={meta.isActive} onChange={(e) => setMeta({ ...meta, isActive: e.target.checked })} /> Active</label>
      </div>

      <section aria-label="Prix par produit" className="space-y-2">
        <div className="hidden grid-cols-[1fr_9rem_10rem_2.5rem] gap-3 px-1 text-xs font-medium text-muted-foreground sm:grid"><span>Produit</span><span className="text-right">Prix standard</span><span>Prix de cette liste ({currency})</span><span /></div>
        {rows.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun prix pour l&apos;instant : les clients de cette liste voient le prix standard. Ajoutez un produit ci-dessous.</p>}
        {rows.map((r) => {
          const p = byId.get(r.productId);
          return (
            <div key={r.productId} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_9rem_10rem_2.5rem] sm:border-0 sm:bg-transparent sm:p-0">
              <span className="min-w-0 truncate text-sm font-medium">{p?.name ?? "Produit"}<span className="block text-xs font-normal text-muted-foreground">{p?.sku}</span></span>
              <span className="hidden text-right text-sm tabular text-muted-foreground sm:block">{p ? formatMoney(p.salePrice, currency) : "—"}</span>
              <Input type="number" min={0} step="any" value={r.price} aria-label={`Prix de ${p?.name ?? "produit"}`} onChange={(e) => setRows((rs) => rs.map((x) => (x.productId === r.productId ? { ...x, price: e.target.value } : x)))} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Retirer ${p?.name ?? "le produit"}`} onClick={() => setRows((rs) => rs.filter((x) => x.productId !== r.productId))}><Trash2 className="size-4" /></Button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Select value={adding || undefined} onValueChange={setAdding}>
            <SelectTrigger className="w-72 max-w-full" aria-label="Produit à ajouter"><SelectValue placeholder="Ajouter un produit…" /></SelectTrigger>
            <SelectContent>{available.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" variant="outline" disabled={!adding} onClick={() => { const p = byId.get(adding); if (p) setRows((rs) => [...rs, { productId: p.id, price: String(p.salePrice) }]); setAdding(""); }}><Plus className="size-4" /> Ajouter</Button>
        </div>
      </section>
      <div className="flex justify-end"><Button disabled={pending || meta.name.trim().length < 2} onClick={save}>{pending ? "Enregistrement…" : "Enregistrer la liste"}</Button></div>
    </div>
  );
}
