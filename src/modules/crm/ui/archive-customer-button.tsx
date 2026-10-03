"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "@/components/app/form-kit";
import { archiveCustomerAction } from "../actions";

export function ArchiveCustomerButton({ customerId, name }: { customerId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}><Archive className="size-4" /> Archiver</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archiver {name} ?</DialogTitle><DialogDescription>Le client disparaît des listes mais son historique est conservé. L'archivage est refusé s'il reste des factures impayées.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button variant="destructive" disabled={pending} onClick={() => start(async () => { const r = await runAction(archiveCustomerAction({ id: customerId }), { success: "Client archivé" }); if (r.ok) { setOpen(false); router.push("/app/crm/clients"); router.refresh(); } })}>Archiver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
