"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/app/form-kit";
import { cancelPaymentAction, validatePaymentAction } from "../actions";

export function PaymentRowActions({ id, status, canValidate, canCancel }: { id: string; status: string; canValidate: boolean; canCancel: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const done = (ok: boolean) => { if (ok) router.refresh(); };
  return (
    <div className="flex items-center justify-end gap-1">
      {status === "PENDING" && canValidate && (
        <Button variant="ghost" size="icon" aria-label="Valider le paiement" disabled={pending} onClick={() => start(async () => done((await runAction(validatePaymentAction({ id }), { success: "Paiement validé" })).ok))}><Check className="size-4 text-success" /></Button>
      )}
      {status !== "CANCELLED" && canCancel && (
        <Button variant="ghost" size="icon" aria-label="Annuler le paiement" disabled={pending} onClick={() => { if (window.confirm("Annuler ce paiement ?")) start(async () => done((await runAction(cancelPaymentAction({ id }), { success: "Paiement annulé" })).ok)); }}><X className="size-4 text-destructive" /></Button>
      )}
      {status !== "PENDING" && <Button variant="ghost" size="icon" asChild aria-label="Reçu PDF"><a href={`/api/pdf/receipt/${id}`} target="_blank" rel="noopener noreferrer"><FileText className="size-4" /></a></Button>}
    </div>
  );
}
