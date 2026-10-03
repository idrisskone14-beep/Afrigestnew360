"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/components/app/form-kit";
import {
  archiveWarehouseAction, createCategoryAction, createWarehouseAction, deleteCategoryAction, renameCategoryAction, updateStockSettingsAction, updateWarehouseAction,
} from "../actions";

interface Wh { id: string; name: string; code: string; address: string; isDefault: boolean; isActive: boolean; units: number }
interface Cat { id: string; name: string; products: number }

export function WarehousesPanel({ warehouses, categories, canManageWarehouses, canManageCategories, allowNegativeStock }: {
  warehouses: Wh[]; categories: Cat[]; canManageWarehouses: boolean; canManageCategories: boolean; allowNegativeStock: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nw, setNw] = useState({ name: "", code: "" });
  const [nc, setNc] = useState("");
  const [catEdit, setCatEdit] = useState<Record<string, string>>({});
  const done = (ok: boolean) => { if (ok) router.refresh(); };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Entrepôts</CardTitle><CardDescription>Lieux de stockage. L'entrepôt par défaut reçoit les entrées et alimente les livraisons.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-lg border">
            {warehouses.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="flex items-center gap-2 text-sm font-medium">{w.name} <span className="text-xs font-normal text-muted-foreground">{w.code}</span>{w.isDefault && <Badge variant="secondary">Par défaut</Badge>}</p><p className="text-xs text-muted-foreground tabular">{w.units} unités en stock</p></div>
                {canManageWarehouses && (
                  <>
                    {!w.isDefault && <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => done((await runAction(updateWarehouseAction({ id: w.id, name: w.name, code: w.code, address: w.address, isDefault: true, isActive: true }), { success: "Entrepôt par défaut modifié" })).ok))}>Par défaut</Button>}
                    {!w.isDefault && <Button variant="ghost" size="icon" aria-label={`Supprimer ${w.name}`} disabled={pending} onClick={() => start(async () => done((await runAction(archiveWarehouseAction({ id: w.id }), { success: "Entrepôt supprimé" })).ok))}><Trash2 className="size-4 text-destructive" /></Button>}
                  </>
                )}
              </li>
            ))}
          </ul>
          {canManageWarehouses && (
            <div className="flex flex-wrap items-end gap-2">
              <Input className="h-9 w-48" placeholder="Nom (ex. Dépôt Nord)" aria-label="Nom de l'entrepôt" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
              <Input className="h-9 w-24" placeholder="Code" aria-label="Code" value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value.toUpperCase() })} />
              <Button disabled={pending || nw.name.trim().length < 2 || !nw.code} onClick={() => start(async () => { const r = await runAction(createWarehouseAction({ name: nw.name, code: nw.code, address: "", isDefault: false }), { success: "Entrepôt créé" }); if (r.ok) { setNw({ name: "", code: "" }); router.refresh(); } })}><Plus className="size-4" /> Ajouter</Button>
            </div>
          )}
          {canManageWarehouses && (
            <label className="flex items-start justify-between gap-4 rounded-lg border p-3 text-sm">
              <span><span className="font-medium">Autoriser le stock négatif</span><span className="block text-xs text-muted-foreground">Permet de livrer avant d'avoir enregistré la réception. Déconseillé : le coût moyen devient moins fiable.</span></span>
              <Switch checked={allowNegativeStock} disabled={pending} aria-label="Autoriser le stock négatif" onCheckedChange={(v) => start(async () => done((await runAction(updateStockSettingsAction({ allowNegativeStock: v }), { success: "Paramètre enregistré" })).ok))} />
            </label>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Catégories de produits</CardTitle><CardDescription>Classez vos produits pour filtrer et analyser.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {categories.length === 0 && <p className="text-sm text-muted-foreground">Aucune catégorie.</p>}
          <ul className="divide-y rounded-lg border">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                {canManageCategories ? (
                  <Input className="h-8 flex-1" value={catEdit[c.id] ?? c.name} aria-label="Nom de la catégorie" onChange={(e) => setCatEdit({ ...catEdit, [c.id]: e.target.value })} />
                ) : <span className="flex-1 text-sm">{c.name}</span>}
                <span className="text-xs text-muted-foreground">{c.products} produit{c.products > 1 ? "s" : ""}</span>
                {canManageCategories && catEdit[c.id] !== undefined && catEdit[c.id] !== c.name && <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await runAction(renameCategoryAction({ id: c.id, name: catEdit[c.id]! }), { success: "Catégorie renommée" }); if (r.ok) { setCatEdit((s) => { const n = { ...s }; delete n[c.id]; return n; }); router.refresh(); } })}>OK</Button>}
                {canManageCategories && <Button variant="ghost" size="icon" aria-label={`Supprimer ${c.name}`} disabled={pending} onClick={() => start(async () => done((await runAction(deleteCategoryAction({ id: c.id }), { success: "Catégorie supprimée" })).ok))}><Trash2 className="size-4 text-destructive" /></Button>}
              </li>
            ))}
          </ul>
          {canManageCategories && (
            <div className="flex gap-2">
              <Input className="h-9 flex-1" placeholder="Nouvelle catégorie" aria-label="Nouvelle catégorie" value={nc} onChange={(e) => setNc(e.target.value)} />
              <Button disabled={pending || nc.trim().length < 2} onClick={() => start(async () => { const r = await runAction(createCategoryAction({ name: nc }), { success: "Catégorie créée" }); if (r.ok) { setNc(""); router.refresh(); } })}><Plus className="size-4" /> Ajouter</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
