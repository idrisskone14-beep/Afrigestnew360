"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { createDeliveryAction } from "../actions";

export interface DeliverableLine { id: string; description: string; unit: string; remaining: number }

export function CreateDeliveryDialog({ orderId, lines, warehouses, defaultWarehouseId }: { orderId: string; lines: DeliverableLine[]; warehouses: { id: string; name: string }[]; defaultWarehouseId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.remaining)])));
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId ?? warehouses[0]?.id ?? "");
  const [date, setDate] = useState(todayInput());
  const [notes, setNotes] = useState("");

  const submit = () => start(async () => {
    setError(null);
    const res = await createDeliveryAction({ orderId, warehouseId, deliveryDate: date, notes, lines: lines.map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id] || 0) })) });
    if (!res.ok) return setError(res.error.message);
    toast.success("Bon de livraison créé");
    setOpen(false);
    router.push(`/app/sales/livraisons/${res.data.id}`);
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button><Truck className="size-4" /> Créer un bon de livraison</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Nouveau bon de livraison</DialogTitle><DialogDescription>Indiquez les quantités à livrer. La sortie de stock a lieu à la confirmation du bon.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            {warehouses.length > 0 && (
              <Field label="Entrepôt">
                <Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
              </Field>
            )}
            <Field label="Date de livraison" htmlFor="dl-date"><Input id="dl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <ul className="divide-y rounded-lg border">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{l.description}</p><p className="text-xs text-muted-foreground">Reste à livrer : {l.remaining} {l.unit}</p></div>
                <Input type="number" min={0} max={l.remaining} step="any" className="h-9 w-28 text-right" aria-label={`Quantité à livrer ${l.description}`} value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </li>
            ))}
          </ul>
          <Field label="Notes" htmlFor="dl-notes"><Input id="dl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Button disabled={pending || lines.every((l) => !Number(qty[l.id]))} onClick={submit}>Créer le bon de livraison</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
