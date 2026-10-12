"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { HandCoins } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { formatMoney } from "@/lib/reference-data";
import { createDepositInvoiceAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

/** Demande d'acompte : crée une facture d'acompte (brouillon) en pourcentage ou en montant TTC du devis / de la commande. */
export function DepositDialog({ source, id, total, currency }: { source: "quote" | "order"; id: string; total: number; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("30");
  const n = Number(value) || 0;
  const amount = mode === "percent" ? (total * n) / 100 : n;

  const submit = () => start(async () => {
    setError(null);
    const res = await createDepositInvoiceAction({ source, id, mode, value: n });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Facture d'acompte créée (brouillon)");
    setOpen(false);
    router.push(`/app/sales/factures/${res.data.id}`);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant="outline"><HandCoins className="size-4" /> Facture d&apos;acompte</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Facture d&apos;acompte</DialogTitle>
          <DialogDescription>Une facture d&apos;acompte est créée en brouillon. À la facture finale, les acomptes émis sont déduits automatiquement : le client ne paie que le solde.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Calcul">
              <Select value={mode} onValueChange={(v) => { setMode(v as typeof mode); setValue(v === "percent" ? "30" : ""); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="percent">Pourcentage du total TTC</SelectItem><SelectItem value="amount">Montant TTC</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label={mode === "percent" ? "Pourcentage (%)" : `Montant (${currency})`} htmlFor="dp-value"><Input id="dp-value" type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          </div>
          <p className="rounded-lg border bg-muted/50 p-3 text-sm">Acompte : <strong>{formatMoney(amount, currency)}</strong> sur un total de {formatMoney(total, currency)}.</p>
          <Button disabled={pending || n <= 0} onClick={submit}>{pending ? "Création…" : "Créer la facture d'acompte"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
