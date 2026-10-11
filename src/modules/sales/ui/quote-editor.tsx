"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import { computeLine, computeTotals } from "@/core/money";
import { cn } from "@/lib/utils";
import { createQuoteAction, updateQuoteAction } from "../actions";
import { DocumentPreview, type PreviewData } from "./document-preview";
import type { EditorInitial, ProductOpt, TaxOpt } from "./document-editor";

interface LineState { key: number; productId: string; description: string; unit: string; quantity: string; unitPrice: string; discountPct: string; taxId: string }

const FREE = "free";
const NONE = "none";
const TABS = [
  { id: "header", label: "En-tête" },
  { id: "products", label: "Produits" },
  { id: "payment", label: "Paiement et mentions" },
  { id: "options", label: "Options" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const frDate = (s: string) => (s ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${s}T12:00:00`)) : "—");

/**
 * Éditeur de devis à deux volets : à gauche le formulaire par onglets, à droite l'aperçu du document en direct,
 * identique au PDF téléchargé. Les montants affichés sont recalculés par le serveur à l'enregistrement.
 */
export function QuoteEditor({ id, number, initial, customers, products, taxes, currency, issuer }: {
  id?: string;
  number?: string | null;
  initial: EditorInitial;
  customers: { id: string; name: string; lines: string[] }[];
  products: ProductOpt[];
  taxes: TaxOpt[];
  currency: string;
  issuer: PreviewData["issuer"];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("header");
  const [f, setF] = useState({ customerId: initial.customerId, date: initial.date, validUntil: initial.secondDate, notes: initial.notes, terms: initial.terms, kind: initial.quoteKind ?? "QUOTE" });
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
    if (p) patch(key, { productId, description: p.name, unit: p.unit, unitPrice: String(p.salePrice), taxId: p.taxId ?? defaultTax });
  };

  const isProforma = f.kind === "PROFORMA";
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
      title: isProforma ? "Facture proforma" : "Devis",
      number: number ?? null,
      currency,
      issuer,
      recipient: customer ? { name: customer.name, lines: customer.lines } : null,
      dates: [{ label: "Date d'émission", value: frDate(f.date) }, { label: "Valable jusqu'au", value: frDate(f.validUntil) }],
      lines: lines.map((l, i) => ({ description: l.description, quantity: inputs[i]!.quantity, unit: l.unit, unitPrice: inputs[i]!.unitPrice, discountPct: inputs[i]!.discountPct, taxRate: inputs[i]!.taxRate, net: amounts[i]!.net.toNumber(), tax: amounts[i]!.tax.toNumber() })),
      totals: [
        { label: "Total HT", value: t.subtotal.toNumber() },
        ...(t.discountTotal.gt(0) ? [{ label: "Remises", value: -t.discountTotal.toNumber() }, { label: "Net HT", value: t.netTotal.toNumber() }] : []),
        { label: "Total TVA", value: t.taxTotal.toNumber() },
        { label: "Total TTC", value: t.total.toNumber() },
        { label: "Net à payer", value: t.total.toNumber(), bold: true },
      ],
      breakdown: [...byRate].map(([r, v]) => ({ rate: r, ...v })).sort((a, b) => a.rate - b.rate),
      notes: f.notes,
      terms: f.terms,
      signatureLabel: "Bon pour accord — date, nom et signature du client :",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rate` ne dépend que de `taxes`
  }, [lines, f, customers, taxes, currency, issuer, number, isProforma]);

  const valid = Boolean(f.customerId) && lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== "");
  const backTo = id ? `/app/sales/devis/${id}` : "/app/sales/devis";

  const submit = () => start(async () => {
    setError(null);
    const payloadLines = lines.map((l) => ({ productId: l.productId, description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) || 0, taxId: l.taxId }));
    const p = { customerId: f.customerId, notes: f.notes, lines: payloadLines, kind: f.kind, issueDate: f.date, validUntil: f.validUntil, terms: f.terms };
    const res = id ? await updateQuoteAction({ ...p, id }) : await createQuoteAction(p);
    if (!res.ok) {
      const fe = res.error.fieldErrors ? Object.entries(res.error.fieldErrors).map(([k, v]) => `${k.replace(/^lines\.(\d+)\./, "Ligne $1 : ")} ${v[0]}`)[0] : null;
      setError(fe ?? res.error.message);
      if (!f.customerId) setTab("header");
      return;
    }
    toast.success(id ? "Enregistré" : f.kind === "PROFORMA" ? "Facture proforma créée" : "Devis créé");
    const newId = id ?? (res.data as { id: string }).id;
    router.push(`/app/sales/devis/${newId}`);
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{id ? `Modifier ${number ?? "le devis"}` : isProforma ? "Nouvelle facture proforma" : "Nouveau devis"}</h1>
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={pending || !valid} title={valid ? undefined : "Choisissez un client et complétez les articles"}>{pending ? "Enregistrement…" : "Enregistrer"}</Button>
          <Button variant="outline" size="icon" aria-label="Fermer sans enregistrer" onClick={() => router.push(backTo)} disabled={pending}><X className="size-4" /></Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <section aria-label="Formulaire" className="min-w-0 space-y-5">
          <FormAlert message={error} />
          <div role="tablist" aria-label="Sections du devis" className="flex flex-wrap gap-x-5 gap-y-1 border-b">
            {TABS.map((t) => (
              <button
                key={t.id} type="button" role="tab" id={`qe-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`qe-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn("-mb-px border-b-[3px] px-1 pb-2.5 pt-1 text-sm font-medium transition-colors", tab === t.id ? "border-brand-2 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "header" && (
            <div role="tabpanel" id="qe-panel-header" aria-labelledby="qe-tab-header" className="grid gap-4">
              <h2 className="font-display text-xl font-semibold">En-tête</h2>
              <Field label="Client *">
                <Select value={f.customerId || undefined} onValueChange={(v) => setF({ ...f, customerId: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Sélectionnez un client" /></SelectTrigger>
                  <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date d'émission *" htmlFor="qe-date"><Input id="qe-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
                <Field label="Valable jusqu'au" htmlFor="qe-valid" hint="Vide = selon la validité par défaut"><Input id="qe-valid" type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></Field>
              </div>
            </div>
          )}

          {tab === "products" && (
            <div role="tabpanel" id="qe-panel-products" aria-labelledby="qe-tab-products" className="grid gap-4">
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
                    <Field label="Désignation *" htmlFor={`qe-d-${l.key}`}><Textarea id={`qe-d-${l.key}`} rows={2} value={l.description} placeholder="Décrivez le produit ou la prestation" onChange={(e) => patch(l.key, { description: e.target.value })} /></Field>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Quantité *" htmlFor={`qe-q-${l.key}`}><Input id={`qe-q-${l.key}`} type="number" min={0} step="any" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} /></Field>
                      <Field label="Unité" htmlFor={`qe-u-${l.key}`}><Input id={`qe-u-${l.key}`} value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} /></Field>
                      <Field label="Prix unit. HT *" htmlFor={`qe-p-${l.key}`}><Input id={`qe-p-${l.key}`} type="number" min={0} step="any" value={l.unitPrice} placeholder="0" onChange={(e) => patch(l.key, { unitPrice: e.target.value })} /></Field>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Taux TVA">
                        <Select value={l.taxId || NONE} onValueChange={(v) => patch(l.key, { taxId: v === NONE ? "" : v })}>
                          <SelectTrigger className="w-full" aria-label={`Taxe article ${i + 1}`}><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value={NONE}>Sans taxe</SelectItem>{taxes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Field label="Remise (%)" htmlFor={`qe-r-${l.key}`}><Input id={`qe-r-${l.key}`} type="number" min={0} max={100} step="any" value={l.discountPct} onChange={(e) => patch(l.key, { discountPct: e.target.value })} /></Field>
                      <Field label="Total HT"><Input readOnly tabIndex={-1} aria-label={`Total HT article ${i + 1}`} value={a.net.toString()} /></Field>
                    </div>
                  </fieldset>
                );
              })}
              <Button type="button" variant="outline" onClick={() => { setLines((ls) => [...ls, blank(nextKey)]); setNextKey((k) => k + 1); }}><Plus className="size-4" /> Ajouter un article</Button>
            </div>
          )}

          {tab === "payment" && (
            <div role="tabpanel" id="qe-panel-payment" aria-labelledby="qe-tab-payment" className="grid gap-4">
              <h2 className="font-display text-xl font-semibold">Paiement et mentions</h2>
              <Field label="Conditions de paiement et mentions" htmlFor="qe-terms" hint="Imprimé sous « Paiement et mentions » (délai, acompte, pénalités de retard, coordonnées bancaires…)">
                <Textarea id="qe-terms" rows={5} value={f.terms} placeholder="Paiement à 30 jours par virement ou mobile money. Acompte de 30 % à la commande." onChange={(e) => setF({ ...f, terms: e.target.value })} />
              </Field>
              <Field label="Notes" htmlFor="qe-notes" hint="Imprimées sous « Notes » sur le document">
                <Textarea id="qe-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </Field>
            </div>
          )}

          {tab === "options" && (
            <div role="tabpanel" id="qe-panel-options" aria-labelledby="qe-tab-options" className="grid gap-4">
              <h2 className="font-display text-xl font-semibold">Options</h2>
              <Field label="Type de document">
                <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as "QUOTE" | "PROFORMA" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="QUOTE">Devis</SelectItem><SelectItem value="PROFORMA">Facture proforma</SelectItem></SelectContent>
                </Select>
              </Field>
              <p className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                Devise du document : <strong className="text-foreground">{currency}</strong> (devise de l&apos;entreprise). Le numéro est attribué à l&apos;enregistrement, selon la numérotation configurée dans les paramètres.
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
