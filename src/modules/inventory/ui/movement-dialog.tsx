"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { stockMovementAction } from "../actions";
import { MOVEMENT_KINDS } from "../schemas";

type Kind = (typeof MOVEMENT_KINDS)[number]["value"];

export function MovementDialog({ products, warehouses, defaultProductId, defaultKind = "IN", canAdjust }: {
  products: { id: string; name: string; sku: string }[]; warehouses: { id: string; name: string }[]; defaultProductId?: string; defaultKind?: Kind; canAdjust: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ kind: defaultKind as Kind, productId: defaultProductId ?? "", warehouseId: warehouses[0]?.id ?? "", toWarehouseId: "", quantity: "", unitCost: "", reason: "" });
  const kinds = MOVEMENT_KINDS.filter((k) => k.value !== "ADJUSTMENT" || canAdjust);
  const isAdj = f.kind === "ADJUSTMENT";
  const isTransfer = f.kind === "TRANSFER";

  const submit = () => start(async () => {
    setError(null);
    const res = await stockMovementAction({ kind: f.kind, productId: f.productId, warehouseId: f.warehouseId, toWarehouseId: f.toWarehouseId, quantity: Number(f.quantity), unitCost: f.unitCost === "" ? "" : Number(f.unitCost), reason: f.reason });
    if (!res.ok) return setError(res.error.fieldErrors ? Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message : res.error.message);
    toast.success("Mouvement enregistré");
    setOpen(false); setF({ ...f, quantity: "", unitCost: "", reason: "" }); router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button><ArrowLeftRight className="size-4" /> Mouvement de stock</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Mouvement de stock</DialogTitle><DialogDescription>Chaque mouvement est tracé (auteur, date, motif) et met à jour le coût moyen pour les entrées valorisées.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Type">
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as Kind })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{kinds.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Produit">
            <Select value={f.productId} onValueChange={(v) => setF({ ...f, productId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Choisir un produit…" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>)}</SelectContent></Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isTransfer ? "Depuis l'entrepôt" : "Entrepôt"}>
              <Select value={f.warehouseId} onValueChange={(v) => setF({ ...f, warehouseId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
            </Field>
            {isTransfer && (
              <Field label="Vers l'entrepôt">
                <Select value={f.toWarehouseId} onValueChange={(v) => setF({ ...f, toWarehouseId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Destination…" /></SelectTrigger><SelectContent>{warehouses.filter((w) => w.id !== f.warehouseId).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
              </Field>
            )}
            <Field label={isAdj ? "Quantité réelle comptée" : "Quantité"} htmlFor="mv-qty"><Input id="mv-qty" type="number" min={0} step="any" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
            {(f.kind === "IN") && <Field label="Coût unitaire d'achat" htmlFor="mv-cost" hint="Optionnel : met à jour le coût moyen"><Input id="mv-cost" type="number" min={0} step="any" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>}
          </div>
          <Field label={isAdj ? "Motif (obligatoire)" : "Motif / référence"} htmlFor="mv-reason"><Input id="mv-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={isAdj ? "Casse, vol, erreur de saisie…" : "Bon de livraison, achat…"} /></Field>
          <Button disabled={pending || !f.productId || !f.warehouseId || f.quantity === ""} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
