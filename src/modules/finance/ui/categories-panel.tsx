"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/components/app/form-kit";
import { createCategoryAction, updateCategoryAction } from "../actions";

interface Row { id: string; name: string; kind: "INCOME" | "EXPENSE"; isActive: boolean }

export function CategoriesPanel({ categories, canManage }: { categories: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const toggle = (c: Row, isActive: boolean) => start(async () => { const r = await runAction(updateCategoryAction({ id: c.id, name: c.name, isActive }), { success: "Catégorie mise à jour" }); if (r.ok) router.refresh(); });
  const groups = [{ kind: "EXPENSE" as const, title: "Dépenses" }, { kind: "INCOME" as const, title: "Recettes" }];
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">Les catégories classent les dépenses et les mouvements de trésorerie ; elles alimentent les budgets. Désactiver une catégorie la masque des nouvelles saisies sans toucher à l'historique.</p>
      {groups.map((g) => (
        <Card key={g.kind} className="divide-y p-0">
          <p className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>
          {categories.filter((c) => c.kind === g.kind).map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1 text-sm">{c.name}{!c.isActive && <Badge variant="outline" className="ml-2">Désactivée</Badge>}</span>
              {canManage && <Switch checked={c.isActive} disabled={pending} aria-label={`Catégorie ${c.name} active`} onCheckedChange={(v) => toggle(c, v)} />}
            </div>
          ))}
        </Card>
      ))}
      {canManage && (
        <Card className="flex flex-wrap items-end gap-2 p-3">
          <div className="grid gap-1"><label htmlFor="cat-name" className="text-xs text-muted-foreground">Nouvelle catégorie</label><Input id="cat-name" className="h-9 w-56" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <Select value={kind} onValueChange={(v) => setKind(v as "INCOME" | "EXPENSE")}><SelectTrigger className="h-9 w-36" aria-label="Type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EXPENSE">Dépense</SelectItem><SelectItem value="INCOME">Recette</SelectItem></SelectContent></Select>
          <Button disabled={pending || name.trim().length < 2} onClick={() => start(async () => { const r = await runAction(createCategoryAction({ name, kind }), { success: "Catégorie ajoutée" }); if (r.ok) { setName(""); router.refresh(); } })}><Plus className="size-4" /> Ajouter</Button>
        </Card>
      )}
    </div>
  );
}
