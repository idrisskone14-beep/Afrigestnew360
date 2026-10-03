"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCheck, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { runAction } from "@/components/app/form-kit";
import { cancelTransactionAction, reconcileAction } from "../actions";

/** Rapprochement bancaire et annulation d'un mouvement (saisies manuelles et transferts uniquement). */
export function TransactionActions({ id, reconciled, canCancel, canReconcile }: { id: string; reconciled: boolean; canCancel: boolean; canReconcile: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (p: ReturnType<typeof reconcileAction>, success: string) => start(async () => { const r = await runAction(p, { success }); if (r.ok) router.refresh(); });
  return (
    <div className="flex items-center justify-end gap-1">
      {canReconcile && (
        <Button variant="ghost" size="icon" disabled={pending} aria-label={reconciled ? "Retirer le rapprochement" : "Marquer comme rapproché"} title={reconciled ? "Rapproché — cliquer pour retirer" : "Marquer comme rapproché"} onClick={() => run(reconcileAction({ id, reconciled: !reconciled }), reconciled ? "Rapprochement retiré" : "Mouvement rapproché")}>
          {reconciled ? <CheckCheck className="size-4 text-success" /> : <Undo2 className="size-4 text-muted-foreground" />}
        </Button>
      )}
      {canCancel && !reconciled && (
        <ActionButton action={cancelTransactionAction} input={{ id }} variant="ghost" size="sm" label="Annuler" icon={<X className="size-4" />} success="Mouvement annulé" confirm={{ title: "Annuler ce mouvement ?", description: "Le solde du compte est recalculé. Un transfert est annulé des deux côtés.", confirmLabel: "Annuler le mouvement" }} />
      )}
    </div>
  );
}
