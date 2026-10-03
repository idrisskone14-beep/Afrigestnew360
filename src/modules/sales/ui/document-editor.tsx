"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import { computeTotals, computeLine } from "@/core/money";
import { formatMoney } from "@/lib/reference-data";
import { createBillAction, createOrderAction as createPurchaseOrderAction, updateBillAction, updateOrderAction as updatePurchaseOrderAction } from "@/modules/purchasing/actions";
import { createInvoiceAction, createOrderAction, createQuoteAction, updateInvoiceAction, updateOrderAction, updateQuoteAction } from "../actions";

export interface ProductOpt { id: string; name: string; sku: string; unit: string; salePrice: number; costPrice: number; taxId: string | null }
export interface TaxOpt { id: string; name: string; rate: number; isDefault: boolean }
interface LineState { key: number; productId: string; description: string; unit: string; quantity: string; unitPrice: string; discountPct: string; taxId: string }

export interface EditorInitial {
  customerId: string;
  date: string;
  secondDate: string;
  notes: string;
  terms: string;
  warehouseId?: string;
  quoteKind?: "QUOTE" | "PROFORMA";
  /** N° de la facture du fournisseur (factures fournisseur). */
  reference?: string;
  branchId?: string;
  costCenterId?: string;
  projectId?: string;
  lines: { productId: string; description: string; unit: string; quantity: number; unitPrice: number; discountPct: number; taxId: string }[];
}

const FREE = "free";
const NONE = "none";
const LABELS = {
  quote: { second: "Valable jusqu'au", noun: "devis", detail: "/app/sales/devis", list: "/app/sales/devis" },
  order: { second: "Livraison prévue", noun: "commande", detail: "/app/sales/commandes", list: "/app/sales/commandes" },
  invoice: { second: "Échéance", noun: "facture", detail: "/app/sales/factures", list: "/app/sales/factures" },
  purchase_order: { second: "Livraison attendue", noun: "commande fournisseur", detail: "/app/purchases/commandes", list: "/app/purchases/commandes" },
  supplier_bill: { second: "Échéance", noun: "facture fournisseur", detail: "/app/purchases/factures", list: "/app/purchases/factures" },
} as const;
const PURCHASE_KINDS = ["purchase_order", "supplier_bill"];

export function DocumentEditor({ kind, id, initial, customers, products, taxes, warehouses, branches, costCenters, projects, currency }: {
  kind: "quote" | "order" | "invoice" | "purchase_order" | "supplier_bill"; id?: string; initial: EditorInitial; customers: { id: string; name: string }[]; products: ProductOpt[]; taxes: TaxOpt[];
  warehouses?: { id: string; name: string }[]; branches?: { id: string; name: string }[]; costCenters?: { id: string; name: string }[]; projects?: { id: string; name: string }[]; currency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ customerId: initial.customerId, date: initial.date, secondDate: initial.secondDate, notes: initial.notes, terms: initial.terms, warehouseId: initial.warehouseId ?? "", quoteKind: initial.quoteKind ?? "QUOTE", reference: initial.reference ?? "", branchId: initial.branchId ?? "", costCenterId: initial.costCenterId ?? "", projectId: initial.projectId ?? "" });
  const buying = PURCHASE_KINDS.includes(kind);
  const defaultTax = taxes.find((t) => t.isDefault)?.id ?? "";
  const blankLine = (key: number): LineState => ({ key, productId: "", description: "", unit: "unité", quantity: "1", unitPrice: "", discountPct: "0", taxId: defaultTax });
  const [lines, setLines] = useState<LineState[]>(() =>
    initial.lines.length ? initial.lines.map((l, i) => ({ key: i, productId: l.productId, description: l.description, unit: l.unit, quantity: String(l.quantity), unitPrice: String(l.unitPrice), discountPct: String(l.discountPct), taxId: l.taxId })) : [blankLine(0)],
  );
  const [nextKey, setNextKey] = useState(initial.lines.length || 1);
  const L = LABELS[kind];
  const rate = (taxId: string) => taxes.find((t) => t.id === taxId)?.rate ?? 0;

  const patch = (key: number, p: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const pickProduct = (key: number, productId: string) => {
    if (productId === FREE) return patch(key, { productId: "" });
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    patch(key, { productId, description: p.name, unit: p.unit, unitPrice: String(buying ? p.costPrice : p.salePrice), taxId: p.taxId ?? defaultTax });
  };

  const totals = useMemo(() => computeTotals(lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, discountPct: Number(l.discountPct) || 0, taxRate: rate(l.taxId) })), currency), [lines, currency, taxes]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => start(async () => {
    setError(null);
    const payloadLines = lines.map((l) => ({ productId: l.productId, description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice || 0), discountPct: Number(l.discountPct || 0), taxId: l.taxId }));
    const common = { customerId: f.customerId, notes: f.notes, lines: payloadLines };
    const supplierCommon = { supplierId: f.customerId, notes: f.notes, lines: payloadLines };
    let res;
    if (kind === "purchase_order") {
      const p = { ...supplierCommon, orderDate: f.date, expectedDate: f.secondDate, warehouseId: f.warehouseId };
      res = id ? await updatePurchaseOrderAction({ ...p, id }) : await createPurchaseOrderAction(p);
    } else if (kind === "supplier_bill") {
      const p = { ...supplierCommon, supplierRef: f.reference, billDate: f.date, dueDate: f.secondDate, branchId: f.branchId, costCenterId: f.costCenterId, projectId: f.projectId };
      res = id ? await updateBillAction({ ...p, id }) : await createBillAction(p);
    } else if (kind === "quote") {
      const p = { ...common, kind: f.quoteKind, issueDate: f.date, validUntil: f.secondDate, terms: f.terms };
      res = id ? await updateQuoteAction({ ...p, id }) : await createQuoteAction(p);
    } else if (kind === "order") {
      const p = { ...common, orderDate: f.date, expectedDelivery: f.secondDate, warehouseId: f.warehouseId };
      res = id ? await updateOrderAction({ ...p, id }) : await createOrderAction(p);
    } else {
      const p = { ...common, issueDate: f.date, dueDate: f.secondDate, terms: f.terms, branchId: f.branchId, costCenterId: f.costCenterId, projectId: f.projectId };
      res = id ? await updateInvoiceAction({ ...p, id }) : await createInvoiceAction(p);
    }
    if (!res.ok) {
      const fe = res.error.fieldErrors ? Object.entries(res.error.fieldErrors).map(([k, v]) => `${k.replace(/^lines\.(\d+)\./, "Ligne $1 : ")} ${v[0]}`)[0] : null;
      return setError(fe ?? res.error.message);
    }
    toast.success(id ? "Enregistré" : `${L.noun[0]!.toUpperCase()}${L.noun.slice(1)} créé`);
    const newId = id ?? (res.data as { id: string }).id;
    router.push(`${L.detail}/${newId}`);
    router.refresh();
  });

  const valid = f.customerId && lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== "");

  return (
    <div className="space-y-6">
      <FormAlert message={error} />
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={buying ? "Fournisseur *" : "Client *"} className="sm:col-span-2">
            <Select value={f.customerId || undefined} onValueChange={(v) => setF({ ...f, customerId: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder={buying ? "Choisir un fournisseur…" : "Choisir un client…"} /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label={kind === "order" || kind === "purchase_order" ? "Date de commande" : kind === "supplier_bill" ? "Date de la facture" : "Date d'émission"} htmlFor="de-date"><Input id="de-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={L.second} htmlFor="de-second" hint={kind === "invoice" ? "Vide = selon le délai du client" : kind === "supplier_bill" ? "Vide = selon le délai du fournisseur" : undefined}><Input id="de-second" type="date" value={f.secondDate} onChange={(e) => setF({ ...f, secondDate: e.target.value })} /></Field>
          {kind === "quote" && (
            <Field label="Type">
              <Select value={f.quoteKind} onValueChange={(v) => setF({ ...f, quoteKind: v as "QUOTE" | "PROFORMA" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="QUOTE">Devis</SelectItem><SelectItem value="PROFORMA">Facture proforma</SelectItem></SelectContent>
              </Select>
            </Field>
          )}
          {kind === "supplier_bill" && (
            <Field label="N° de facture du fournisseur" htmlFor="de-ref" hint="Sert à détecter les doublons"><Input id="de-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          )}
          {(kind === "invoice" || kind === "supplier_bill") && branches && branches.length > 0 && (
            <Field label="Agence">
              <Select value={f.branchId || NONE} onValueChange={(v) => setF({ ...f, branchId: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Non affectée</SelectItem>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select>
            </Field>
          )}
          {(kind === "invoice" || kind === "supplier_bill") && costCenters && costCenters.length > 0 && (
            <Field label="Centre de coûts">
              <Select value={f.costCenterId || NONE} onValueChange={(v) => setF({ ...f, costCenterId: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Non affecté</SelectItem>{costCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
            </Field>
          )}
          {(kind === "invoice" || kind === "supplier_bill") && projects && projects.length > 0 && (
            <Field label="Projet"><Select value={f.projectId || NONE} onValueChange={(v) => setF({ ...f, projectId: v === NONE ? "" : v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>Aucun projet</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></Field>
          )}
          {(kind === "order" || kind === "purchase_order") && warehouses && warehouses.length > 0 && (
            <Field label={buying ? "Entrepôt de réception" : "Entrepôt de livraison"}>
              <Select value={f.warehouseId || NONE} onValueChange={(v) => setF({ ...f, warehouseId: v === NONE ? "" : v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Par défaut</SelectItem>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
        </CardContent>
      </Card>

      <section aria-label="Lignes du document" className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Lignes</h3>
        <div className="hidden grid-cols-[minmax(10rem,1.1fr)_minmax(12rem,2fr)_5rem_5.5rem_7rem_4.5rem_8rem_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid">
          <span>Produit</span><span>Désignation</span><span>Qté</span><span>Unité</span><span>P.U. HT</span><span>Rem. %</span><span>Taxe</span><span />
        </div>
        {lines.map((l, i) => {
          const a = computeLine({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, discountPct: Number(l.discountPct) || 0, taxRate: rate(l.taxId) }, currency);
          return (
            <div key={l.key} className="grid gap-2 rounded-lg border bg-card p-3 lg:grid-cols-[minmax(10rem,1.1fr)_minmax(12rem,2fr)_5rem_5.5rem_7rem_4.5rem_8rem_2rem] lg:items-start lg:border-0 lg:bg-transparent lg:p-0">
              <Select value={l.productId || FREE} onValueChange={(v) => pickProduct(l.key, v)}>
                <SelectTrigger className="w-full" aria-label={`Produit ligne ${i + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={FREE}>— Ligne libre —</SelectItem>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>)}</SelectContent>
              </Select>
              <Input value={l.description} placeholder="Désignation" aria-label={`Désignation ligne ${i + 1}`} onChange={(e) => patch(l.key, { description: e.target.value })} />
              <Input type="number" min={0} step="any" value={l.quantity} aria-label={`Quantité ligne ${i + 1}`} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
              <Input value={l.unit} aria-label={`Unité ligne ${i + 1}`} onChange={(e) => patch(l.key, { unit: e.target.value })} />
              <Input type="number" min={0} step="any" value={l.unitPrice} placeholder="0" aria-label={`Prix unitaire ligne ${i + 1}`} onChange={(e) => patch(l.key, { unitPrice: e.target.value })} />
              <Input type="number" min={0} max={100} step="any" value={l.discountPct} aria-label={`Remise ligne ${i + 1}`} onChange={(e) => patch(l.key, { discountPct: e.target.value })} />
              <Select value={l.taxId || NONE} onValueChange={(v) => patch(l.key, { taxId: v === NONE ? "" : v })}>
                <SelectTrigger className="w-full" aria-label={`Taxe ligne ${i + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Sans taxe</SelectItem>{taxes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex items-center justify-between gap-2 lg:contents">
                <span className="tabular text-sm font-medium lg:hidden">{formatMoney(a.total.toNumber(), currency)}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Supprimer la ligne ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-muted-foreground" /></Button>
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={() => { setLines((ls) => [...ls, blankLine(nextKey)]); setNextKey((k) => k + 1); }}><Plus className="size-4" /> Ajouter une ligne</Button>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-4">
          <Field label="Notes (visibles sur le document)" htmlFor="de-notes"><Textarea id="de-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {kind !== "order" && !buying && <Field label="Conditions" htmlFor="de-terms"><Textarea id="de-terms" rows={2} value={f.terms} placeholder="Conditions de paiement, pénalités de retard…" onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>}
        </div>
        <Card>
          <CardContent className="space-y-1.5 p-5" aria-live="polite">
            <Row label="Total HT" value={formatMoney(totals.subtotal.toNumber(), currency)} />
            {totals.discountTotal.gt(0) && <Row label="Remises" value={`− ${formatMoney(totals.discountTotal.toNumber(), currency)}`} />}
            <Row label="TVA / taxes" value={formatMoney(totals.taxTotal.toNumber(), currency)} />
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total TTC</span><span className="tabular">{formatMoney(totals.total.toNumber(), currency)}</span></div>
            <p className="pt-1 text-xs text-muted-foreground">Montants recalculés par le serveur à l'enregistrement.</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.push(id ? `${L.detail}/${id}` : L.list)} disabled={pending}>Annuler</Button>
        <Button onClick={submit} disabled={pending || !valid}>{id ? "Enregistrer les modifications" : `Créer le ${L.noun}`}</Button>
      </div>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => <div className="flex justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className="tabular">{value}</span></div>;
