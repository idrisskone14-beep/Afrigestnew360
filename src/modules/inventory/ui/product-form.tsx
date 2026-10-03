"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { createProductAction, updateProductAction } from "../actions";
import { UNITS, productSchema, type ProductInput } from "../schemas";

const NONE = "none";
const EMPTY: ProductInput = {
  sku: "", name: "", description: "", type: "GOODS", categoryId: "", unit: "unité", barcode: "", salePrice: 0, costPrice: 0, taxId: "", trackStock: true, minStock: 0,
  openingWarehouseId: "", openingQuantity: "",
};

export interface Option { id: string; name: string }

export function ProductFormDialog({ productId, initial, isActive = true, categories, warehouses, taxes }: {
  productId?: string; initial?: ProductInput; isActive?: boolean; categories: Option[]; warehouses: Option[]; taxes: (Option & { rate: number; isDefault: boolean })[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(productId);
  const defaults = initial ?? { ...EMPTY, taxId: taxes.find((t) => t.isDefault)?.id ?? "", openingWarehouseId: warehouses[0]?.id ?? "" };
  const { register, control, handleSubmit, setError, reset, formState: { errors } } = useForm<ProductInput>({ resolver: zodResolver(productSchema), defaultValues: defaults });
  const type = useWatch({ control, name: "type" });
  const track = useWatch({ control, name: "trackStock" });
  const goods = type === "GOODS";

  const sel = (name: "categoryId" | "taxId" | "openingWarehouseId", items: { id: string; label: string }[], none = true) => (
    <Controller control={control} name={name} render={({ field }) => (
      <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{none && <SelectItem value={NONE}>— Aucun —</SelectItem>}{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
    )} />
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { reset(defaults); setFormError(null); } }}>
      <DialogTrigger asChild>{editing ? <Button variant="outline"><Pencil className="size-4" /> Modifier</Button> : <Button><Plus className="size-4" /> Nouveau produit</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "Modifier le produit" : "Nouveau produit ou service"}</DialogTitle><DialogDescription>La référence est générée automatiquement si vous la laissez vide.</DialogDescription></DialogHeader>
        <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => start(async () => {
          setFormError(null);
          const res = editing
            ? await updateProductAction({ ...v, id: productId!, isActive })
            : await createProductAction(v);
          if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
          toast.success(editing ? "Produit mis à jour" : "Produit créé");
          setOpen(false);
          if (!editing && res.ok && res.data) router.push(`/app/inventory/produits/${(res.data as { id: string }).id}`);
          else router.refresh();
        }))}>
          <div className="sm:col-span-2"><FormAlert message={formError} /></div>
          <Field label="Type">
            <Controller control={control} name="type" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GOODS">Produit (marchandise)</SelectItem><SelectItem value="SERVICE">Service</SelectItem></SelectContent></Select>
            )} />
          </Field>
          <Field label="Référence" htmlFor="pr-sku" error={errors.sku?.message}><Input id="pr-sku" placeholder="Automatique" {...register("sku")} /></Field>
          <Field label="Désignation *" htmlFor="pr-name" className="sm:col-span-2" error={errors.name?.message}><Input id="pr-name" autoFocus {...register("name")} /></Field>
          <Field label="Catégorie">{sel("categoryId", categories.map((c) => ({ id: c.id, label: c.name })))}</Field>
          <Field label="Unité" error={errors.unit?.message}>
            <Controller control={control} name="unit" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([field.value, ...UNITS])].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select>
            )} />
          </Field>
          <Field label="Prix de vente HT" htmlFor="pr-price" error={errors.salePrice?.message}><Input id="pr-price" type="number" min={0} step="any" {...register("salePrice")} /></Field>
          <Field label={goods && track ? "Coût d'achat initial" : "Coût"} htmlFor="pr-cost" hint={goods && track && editing ? "Le coût moyen est recalculé à chaque entrée de stock." : undefined} error={errors.costPrice?.message}>
            <Input id="pr-cost" type="number" min={0} step="any" disabled={editing && goods && track} {...register("costPrice")} />
          </Field>
          <Field label="Taxe par défaut">{sel("taxId", taxes.map((t) => ({ id: t.id, label: `${t.name}` })))}</Field>
          <Field label="Code-barres" htmlFor="pr-bar" error={errors.barcode?.message}><Input id="pr-bar" {...register("barcode")} /></Field>
          {goods && (
            <>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Controller control={control} name="trackStock" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />} /> Suivre le stock de ce produit
              </label>
              {track && (
                <>
                  <Field label="Seuil minimum" htmlFor="pr-min" hint="Alerte sous ce niveau" error={errors.minStock?.message}><Input id="pr-min" type="number" min={0} step="any" {...register("minStock")} /></Field>
                  {!editing && (
                    <>
                      <Field label="Entrepôt du stock initial">{sel("openingWarehouseId", warehouses.map((w) => ({ id: w.id, label: w.name })), false)}</Field>
                      <Field label="Quantité initiale" htmlFor="pr-open" error={errors.openingQuantity?.message}><Input id="pr-open" type="number" min={0} step="any" {...register("openingQuantity")} /></Field>
                    </>
                  )}
                </>
              )}
            </>
          )}
          <Field label="Description" htmlFor="pr-desc" className="sm:col-span-2" error={errors.description?.message}><Textarea id="pr-desc" rows={2} {...register("description")} /></Field>
          <div className="sm:col-span-2"><SubmitButton pending={pending}>{editing ? "Enregistrer" : "Créer"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
