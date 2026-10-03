"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "@/components/app/form-kit";
import { archiveProductAction } from "../actions";

export function ArchiveProductButton({ productId, name }: { productId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}><Archive className="size-4" /> Archiver</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archiver {name} ?</DialogTitle><DialogDescription>Le produit disparaît des listes et des nouveaux documents ; son historique est conservé. Impossible tant qu'il reste du stock.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button variant="destructive" disabled={pending} onClick={() => start(async () => { const r = await runAction(archiveProductAction({ id: productId }), { success: "Produit archivé" }); if (r.ok) { setOpen(false); router.push("/app/inventory/produits"); router.refresh(); } })}>Archiver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
