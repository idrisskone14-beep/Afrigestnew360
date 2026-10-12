"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, ScanBarcode, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BarcodeScannerDialog } from "@/components/app/barcode-scanner";
import { Field, FormAlert } from "@/components/app/form-kit";
import { computeLine, computeTotals } from "@/core/money";
import { cn } from "@/lib/utils";
import { createInvoiceAction, createOrderAction, createQuoteAction, updateInvoiceAction, updateOrderAction, updateQuoteAction } from "../actions";
import { DocumentPreview, type PreviewData } from "./document-preview";
import type { EditorInitial, ProductOpt, TaxOpt } from "./document-editor";

interface LineState { key: number; productId: string; description: string; unit: string; quantity: string; unitPrice: string; discountPct: string; taxId: string }
type Opt = { id: string; name: string };
export type SalesDocKind = "quote" | "order" | "invoice";

const FREE = "free";
const NONE = "none";

/** Ce qui change d'un document de vente à l'autre : libellés, route, onglets, bloc de totaux du document. */
const CONFIG = {
  quote: { noun: "devis", article: "le", list: "/app/sales/devis", dateLabel: "Date d'émission", secondLabel: "Valable jusqu'au", secondHint: "Vide = selon la validité par défaut", title: "Devis", newTitle: "Nouveau devis", signature: "Bon pour accord — date, nom et signature du client :", netToPay: true, hasTerms: true, numberPlaceholder: "attribué à l'enregistrement" },
  order: { noun: "commande", article: "la", list: "/app/sales/commandes", dateLabel: "Date de commande", secondLabel: "Livraison prévue", secondHint: undefined, title: "Bon de commande", newTitle: "Nouvelle commande", signature: undefined, netToPay: false, hasTerms: false, numberPlaceholder: "attribué à l'enregistrement" },
  invoice: { noun: "facture", article: "la", list: "/app/sales/factures", dateLabel: "Date d'émission", secondLabel: "Échéance", secondHint: "Vide = selon le délai du client", title: "Facture", newTitle: "Nouvelle facture", signature: undefined, netToPay: false, hasTerms: true, numberPlaceholder: "attribué à l'émission" },
} as const;

const frDate = (s: string) => (s ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${s}T12:00:00`)) : "—");

/**
 * Éditeur de devis, de commande et de facture à deux volets : à gauche le formulaire par onglets, à droite l'aperçu du
 * document en direct, identique au PDF téléchargé. Les montants affichés sont recalculés par le serveur à l'enregistrement.
 */
export function SalesEditor({ kind, id, number, initial, customers, products, taxes, currency, issuer, warehouses = [], branches = [], costCenters = [], projects = [] }: {
  kind: SalesDocKind;
  id?: string;
  number?: string | null;
  initial: EditorInitial;
  customers: { id: string; name: string; lines: string[]; priceListName?: string | null; prices?: Record<string, number> }[];
  products: ProductOpt[];
  taxes: TaxOpt[];
  currency: string;
  issuer: PreviewData["issuer"];
  warehouses?: Opt[]; branches?: Opt[]; costCenters?: Opt[]; projects?: Opt[];
}) {
  const C = CONFIG[kind];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tabs = useMemo(() => [
    { id: "header", label: "En-tête" },
    { id: "products", label: "Produits" },
    { id: "payment", label: C.hasTerms ? "Paiement et mentions" : "Notes" },
    { id: "options", label: "Options" },
  ] as const, [C.hasTerms]);
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("header");
  const [scanning, setScanning] = useState(false);
  const [f, setF] = useState({
    customerId: initial.customerId, date: initial.date, second: initial.secondDate, notes: initial.notes, terms: initial.terms, quoteKind: initial.quoteKind ?? "QUOTE",
    warehouseId: initial.warehouseId ?? "", branchId: initial.branchId ?? "", costCenterId: initial.costCenterId ?? "", projectId: initial.projectId ?? "",
  });
  const defaultTax = taxes.find((t) => t.isDefault)?.id ?? "";
  const blank = (key: number): LineState => ({ key, productId: "", description: "", unit: "unité", quantity: "1", unitPrice: "", discountPct: "0", taxId: defaultTax });
  const [lines, setLines] = useState<LineState[]>(() =>
    initial.lines.length
      ? initial.lines.map((l, i) => ({ key: i, productId: l.productId, description: l.description, unit: l.unit, quantity: String(l.quantity), unitPrice: String(l.unitPrice), discountPct: String(l.discountPct), taxId: l.taxId }))
      : [blank(0)],
  );
  const [nextKey, setNextKey] = useState(initial.lines.length || 1);
  const rate = (taxId: string) => taxes.find((t) => t.id === taxId)?.rate ?? 0;
  const patch = (key: number, p: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const pickProduct = (key: number, productId: string) => {
    if (productId === FREE) return patch(key, { productId: "" });
    const p = products.find((x) => x.id === productId);
    // prix de la liste du client s'il y en a un pour ce produit, sinon prix de vente standard
    if (p) patch(key, { productId, description: p.name, unit: p.unit, unitPrice: String(customers.find((c) => c.id === f.customerId)?.prices?.[p.id] ?? p.salePrice), taxId: p.taxId ?? defaultTax });
  };

  /** Article scanné : ajoute une ligne avec le prix (liste du client ou prix standard), ou augmente la quantité de la ligne existante. */
  const addScanned = (code: string) => {
    const c = code.trim().toLowerCase();
    const p = products.find((x) => x.barcode?.toLowerCase() === c) ?? products.find((x) => x.sku.toLowerCase() === c);
    setScanning(false);
    if (!p) { toast.error(`Aucun produit pour le code « ${code} »`); return; }
    const price = String(customers.find((x) => x.id === f.customerId)?.prices?.[p.id] ?? p.salePrice);
    const existing = lines.find((l) => l.productId === p.id);
    if (existing) {
      setLines((ls) => ls.map((l) => (l.key === existing.key ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l)));
    } else {
      const fresh: LineState = { key: nextKey, productId: p.id, description: p.name, unit: p.unit, quantity: "1", unitPrice: price, discountPct: "0", taxId: p.taxId ?? defaultTax };
      // une ligne vierge (jamais remplie) est remplacée plutôt que laissée vide
      setLines((ls) => (ls.length === 1 && !ls[0]!.productId && !ls[0]!.description.trim() && ls[0]!.unitPrice === "" ? [fresh] : [...ls, fresh]));
      setNextKey((k) => k + 1);
    }
    toast.success(existing ? `${p.name} : quantité augmentée` : `${p.name} ajouté`);
  };

  const isProforma = kind === "quote" && f.quoteKind === "PROFORMA";
  const docTitle = isProforma ? "Facture proforma" : C.title;
  const preview = useMemo<PreviewData>(() => {
    const inputs = lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, discountPct: Number(l.discountPct) || 0, taxRate: rate(l.taxId) }));
    const amounts = inputs.map((x) => computeLine(x, currency));
    const t = computeTotals(inputs, currency);
    const byRate = new Map<number, { base: number; tax: number }>();
    inputs.forEach((x, i) => {
      const cur = byRate.get(x.taxRate) ?? { base: 0, tax: 0 };
      byRate.set(x.taxRate, { base: cur.base + amounts[i]!.net.toNumber(), tax: cur.tax + amounts[i]!.tax.toNumber() });
    });
    const customer = customers.find((c) => c.id === f.customerId);
    return {
      title: docTitle,
      number: number ?? null,
      numberPlaceholder: C.numberPlaceholder,
      currency,
      issuer,
      recipient: customer ? { name: customer.name, lines: customer.lines } : null,
      dates: [{ label: C.dateLabel, value: frDate(f.date) }, { label: C.secondLabel, value: frDate(f.second) }],
      lines: lines.map((l, i) => ({ description: l.description, quantity: inputs[i]!.quantity, unit: l.unit, unitPrice: inputs[i]!.unitPrice, discountPct: inputs[i]!.discountPct, taxRate: inputs[i]!.taxRate, net: amounts[i]!.net.toNumber(), tax: amounts[i]!.tax.toNumber() })),
      totals: [
        { label: "Total HT", value: t.subtotal.toNumber() },
        ...(t.discountTotal.gt(0) ? [{ label: "Remises", value: -t.discountTotal.toNumber() }, { label: "Net HT", value: t.netTotal.toNumber() }] : []),
        { label: "Total TVA", value: t.taxTotal.toNumber() },
        { label: "Total TTC", value: t.total.toNumber(), bold: !C.netToPay },
        ...(C.netToPay ? [{ label: "Net à payer", value: t.total.toNumber(), bold: true }] : []),
      ],
      breakdown: [...byRate].map(([r, v]) => ({ rate: r, ...v })).sort((a, b) => a.rate - b.rate),
      notes: f.notes,
      terms: C.hasTerms ? f.terms : "",
      signatureLabel: C.signature,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rate` ne dépend que de `taxes`
  }, [lines, f, customers, taxes, currency, issuer, number, docTitle, C]);

  const valid = Boolean(f.customerId) && lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== "");
  const backTo = id ? `${C.list}/${id}` : C.list;

  const submit = () => start(async () => {
    setError(null);
    const payloadLines = lines.map((l) => ({ productId: l.productId, description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) || 0, taxId: l.taxId }));
    const common = { customerId: f.customerId, notes: f.notes, lines: payloadLines };
    let res;
    if (kind === "quote") {
      const p = { ...common, kind: f.quoteKind, issueDate: f.date, validUntil: f.second, terms: f.terms };
      res = id ? await updateQuoteAction({ ...p, id }) : await createQuoteAction(p);
    } else if (kind === "order") {
      const p = { ...common, orderDate: f.date, expectedDelivery: f.second, warehouseId: f.warehouseId };
      res = id ? await updateOrderAction({ ...p, id }) : await createOrderAction(p);
    } else {
      const p = { ...common, issueDate: f.date, dueDate: f.second, terms: f.terms, branchId: f.branchId, costCenterId: f.costCenterId, projectId: f.projectId };
      res = id ? await updateInvoiceAction({ ...p, id }) : await createInvoiceAction(p);
    }
    if (!res.ok) {
      const fe = res.error.fieldErrors ? Object.entries(res.error.fieldErrors).map(([k, v]) => `${k.replace(/^lines\.(\d+)\./, "Ligne $1 : ")} ${v[0]}`)[0] : null;
      setError(fe ?? res.error.message);
      if (!f.customerId) setTab("header");
      return;
    }
    toast.success(id ? "Enregistré" : isProforma ? "Facture proforma créée" : `${C.noun[0]!.toUpperCase()}${C.noun.slice(1)} ${kind === "quote" ? "créé" : "créée"}`);
    const newId = id ?? (res.data as { id: string }).id;
    router.push(`${C.list}/${newId}`);
    router.refresh();
  });

  const optSelect = (label: string, value: string, key: "warehouseId" | "branchId" | "costCenterId" | "projectId", none: string, list: Opt[]) => (
    <Field label={label}>
      <Select value={value || NONE} onValueChange={(v) => setF({ ...f, [key]: v === NONE ? "" : v })}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={NONE}>{none}</SelectItem>{list.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{id ? `Modifier ${number ?? `${C.article} ${C.noun}`}` : isProforma ? "Nouvelle facture proforma" : C.newTitle}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={pending || !valid} title={valid ? undefined : "Choisissez un client et complétez les articles"}>{pending ? "Enregistrement…" : "Enregistrer"}</Button>
          <Button variant="outline" size="icon" aria-label="Fermer sans enregistrer" onClick={() => router.push(backTo)} disabled={pending}><X className="size-4" /></Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <section aria-label="Formulaire" className="min-w-0 space-y-5">
          <FormAlert message={error} />
          <div role="tablist" aria-label={`Sections de ${C.article === "le" ? "ce" : "cette"} ${C.noun}`} className="flex flex-wrap gap-x-5 gap-y-1 border-b">
            {tabs.map((t) => (
              <button
                key={t.id} type="button" role="tab" id={`se-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`se-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn("-mb-px border-b-[3px] px-1 pb-2.5 pt-1 text-sm font-medium transition-colors", tab === t.id ? "border-brand-2 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "header" && (
            <div role="tabpanel" id="se-panel-header" aria-labelledby="se-tab-header" className="grid gap-4">
              <h2 className="font-display text-xl font-semibold">En-tête</h2>
              <Field label="Client *">
                <Select value={f.customerId || undefined} onValueChange={(v) => setF({ ...f, customerId: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Sélectionnez un client" /></SelectTrigger>
                  <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {customers.find((c) => c.id === f.customerId)?.priceListName && <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm">Liste de prix du client : <strong>{customers.find((c) => c.id === f.customerId)?.priceListName}</strong>. Ses prix sont proposés quand vous choisissez un article (modifiables).</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`${C.dateLabel} *`} htmlFor="se-date"><Input id="se-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
                <Field label={C.secondLabel} htmlFor="se-second" hint={C.secondHint}><Input id="se-second" type="date" value={f.second} onChange={(e) => setF({ ...f, second: e.target.value })} /></Field>
              </div>
            </div>
          )}

          {tab === "products" && (
            <div role="tabpanel" id="se-panel-products" aria-labelledby="se-tab-products" className="grid gap-4">
              <h2 className="font-display text-xl font-semibold">Produits</h2>
              {lines.map((l, i) => {
                const a = computeLine({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, discountPct: Number(l.discountPct) || 0, taxRate: rate(l.taxId) }, currency);
                return (
                  <fieldset key={l.key} className="grid gap-3 rounded-lg border bg-card p-4">
                    <legend className="sr-only">Article {i + 1}</legend>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">Article {i + 1}</p>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Supprimer l'article ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4" /></Button>
                    </div>
                    <Field label="Article">
                      <Select value={l.productId || FREE} onValueChange={(v) => pickProduct(l.key, v)}>
                        <SelectTrigger className="w-full" aria-label={`Article ${i + 1}`}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value={FREE}>Ligne libre</SelectItem>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Désignation *" htmlFor={`se-d-${l.key}`}><Textarea id={`se-d-${l.key}`} rows={2} value={l.description} placeholder="Décrivez le produit ou la prestation" onChange={(e) => patch(l.key, { description: e.target.value })} /></Field>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Quantité *" htmlFor={`se-q-${l.key}`}><Input id={`se-q-${l.key}`} type="number" min={0} step="any" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} /></Field>
                      <Field label="Unité" htmlFor={`se-u-${l.key}`}><Input id={`se-u-${l.key}`} value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} /></Field>
                      <Field label="Prix unit. HT *" htmlFor={`se-p-${l.key}`}><Input id={`se-p-${l.key}`} type="number" min={0} step="any" value={l.unitPrice} placeholder="0" onChange={(e) => patch(l.key, { unitPrice: e.target.value })} /></Field>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Taux TVA">
                        <Select value={l.taxId || NONE} onValueChange={(v) => patch(l.key, { taxId: v === NONE ? "" : v })}>
                          <SelectTrigger className="w-full" aria-label={`Taxe article ${i + 1}`}><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value={NONE}>Sans taxe</SelectItem>{taxes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Field label="Remise (%)" htmlFor={`se-r-${l.key}`}><Input id={`se-r-${l.key}`} type="number" min={0} max={100} step="any" value={l.discountPct} onChange={(e) => patch(l.key, { discountPct: e.target.value })} /></Field>
                      <Field label="Total HT"><Input readOnly tabIndex={-1} aria-label={`Total HT article ${i + 1}`} value={a.net.toString()} /></Field>
                    </div>
                  </fieldset>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => { setLines((ls) => [...ls, blank(nextKey)]); setNextKey((k) => k + 1); }}><Plus className="size-4" /> Ajouter un article</Button>
                <Button type="button" variant="outline" onClick={() => setScanning(true)}><ScanBarcode className="size-4" /> Scanner un code-barres</Button>
              </div>
              <BarcodeScannerDialog open={scanning} onOpenChange={setScanning} onDetected={addScanned} title="Ajouter un article" description="Scannez le code-barres du produit : il est ajouté à la ligne, ou sa quantité augmente." />
            </div>
          )}

          {tab === "payment" && (
            <div role="tabpanel" id="se-panel-payment" aria-labelledby="se-tab-payment" className="grid gap-4">
              <h2 className="font-display text-xl font-semibold">{C.hasTerms ? "Paiement et mentions" : "Notes"}</h2>
              {C.hasTerms && (
                <Field label="Conditions de paiement et mentions" htmlFor="se-terms" hint="Imprimé sous « Paiement et mentions » (délai, acompte, pénalités de retard, coordonnées bancaires…)">
                  <Textarea id="se-terms" rows={5} value={f.terms} placeholder="Paiement à 30 jours par virement ou mobile money. Acompte de 30 % à la commande." onChange={(e) => setF({ ...f, terms: e.target.value })} />
                </Field>
              )}
              <Field label="Notes" htmlFor="se-notes" hint="Imprimées sous « Notes » sur le document">
                <Textarea id="se-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </Field>
            </div>
          )}

          {tab === "options" && (
            <div role="tabpanel" id="se-panel-options" aria-labelledby="se-tab-options" className="grid gap-4">
              <h2 className="font-display text-xl font-semibold">Options</h2>
              {kind === "quote" && (
                <Field label="Type de document">
                  <Select value={f.quoteKind} onValueChange={(v) => setF({ ...f, quoteKind: v as "QUOTE" | "PROFORMA" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="QUOTE">Devis</SelectItem><SelectItem value="PROFORMA">Facture proforma</SelectItem></SelectContent>
                  </Select>
                </Field>
              )}
              {kind === "order" && warehouses.length > 0 && optSelect("Entrepôt de livraison", f.warehouseId, "warehouseId", "Par défaut", warehouses)}
              {kind === "invoice" && branches.length > 0 && optSelect("Agence", f.branchId, "branchId", "Non affectée", branches)}
              {kind === "invoice" && costCenters.length > 0 && optSelect("Centre de coûts", f.costCenterId, "costCenterId", "Non affecté", costCenters)}
              {kind === "invoice" && projects.length > 0 && optSelect("Projet", f.projectId, "projectId", "Aucun projet", projects)}
              <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                Devise du document : <strong className="text-foreground">{currency}</strong> (devise de l&apos;entreprise). Le numéro est {kind === "invoice" ? "attribué à l'émission de la facture" : "attribué à l'enregistrement"}, selon la numérotation configurée dans les paramètres.
              </p>
            </div>
          )}
        </section>

        <section aria-label="Aperçu du document" className="min-w-0 rounded-xl bg-muted/70 p-3 sm:p-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <DocumentPreview data={preview} />
        </section>
      </div>
    </div>
  );
}
