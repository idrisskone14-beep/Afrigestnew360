"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/components/app/form-kit";
import { resetLayoutAction, saveLayoutAction } from "../actions";

export interface LayoutEntry { key: string; title: string; visible: boolean }

/** Choix des widgets affichés et de leur ordre (propre à l'utilisateur et à l'entreprise). */
export function CustomizeDialog({ initial }: { initial: LayoutEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [items, setItems] = useState(initial);
  const move = (i: number, dir: -1 | 1) => setItems((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const save = () => start(async () => {
    const r = await runAction(saveLayoutAction({ layout: items.map((x) => ({ key: x.key, visible: x.visible })) }), { success: "Tableau de bord enregistré" });
    if (r.ok) { setOpen(false); router.refresh(); }
  });
  const reset = () => start(async () => {
    const r = await runAction(resetLayoutAction({}), { success: "Disposition par défaut rétablie" });
    if (r.ok) { setOpen(false); router.refresh(); toast.message("Rechargez la page pour revoir la disposition par défaut dans cette fenêtre."); }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setItems(initial); }}>
      <DialogTrigger asChild><Button variant="outline" className="border-white/25 bg-white/10 text-white backdrop-blur hover:border-white/40 hover:bg-white/20 hover:text-white"><SlidersHorizontal className="size-4" /> Personnaliser</Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Personnaliser le tableau de bord</DialogTitle><DialogDescription>Affichez ou masquez les widgets et changez leur ordre. Seuls les widgets que votre rôle et les modules actifs permettent sont proposés.</DialogDescription></DialogHeader>
        <ul className="divide-y rounded-lg border">
          {items.map((it, i) => (
            <li key={it.key} className="flex items-center gap-2 px-3 py-2">
              <Switch checked={it.visible} aria-label={`Afficher « ${it.title} »`} onCheckedChange={(v) => setItems((l) => l.map((x) => (x.key === it.key ? { ...x, visible: v } : x)))} />
              <span className={`min-w-0 flex-1 truncate text-sm ${it.visible ? "" : "text-muted-foreground"}`}>{it.title}</span>
              <Button size="icon" variant="ghost" aria-label={`Monter « ${it.title} »`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
              <Button size="icon" variant="ghost" aria-label={`Descendre « ${it.title} »`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={pending} onClick={reset}><RotateCcw className="size-4" /> Rétablir</Button>
          <Button disabled={pending} onClick={save}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
