"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Camera, ImagePlus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { compressImage } from "@/lib/image-compress";
import { todayInput } from "@/lib/format";
import { captureExpenseAction } from "@/modules/finance/actions";

const METHODS = [
  { value: "CASH", label: "Espèces" }, { value: "MOBILE_MONEY", label: "Mobile money" }, { value: "CARD", label: "Carte" },
  { value: "BANK_TRANSFER", label: "Virement" }, { value: "CHEQUE", label: "Chèque" }, { value: "OTHER", label: "Autre" },
] as const;

const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);

/** Dépense saisie depuis le téléphone : photo du justificatif (caméra ou galerie), quatre champs, un bouton. */
export function CaptureForm({ categories, currency, canAttach }: { categories: { id: string; name: string }[]; currency: string; canAttach: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ description: "", amount: "", date: todayInput(), categoryId: categories[0]?.id ?? "", method: "CASH" });
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  // aperçu local de la photo ; l'adresse temporaire est libérée dès que la photo change ou que l'écran se ferme
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setPhoto(await compressImage(file));
    setBusy(false);
  };

  const valid = Number(f.amount) > 0 && f.description.trim().length >= 2 && f.categoryId && (!canAttach || photo);

  const submit = () => start(async () => {
    setError(null);
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.set(k, v);
    if (photo) form.set("photo", photo, photo.name);
    const res = await captureExpenseAction(form);
    if (!res.ok) return setError(res.error.fieldErrors ? Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message : res.error.message);
    if (res.data.warning) toast.warning(res.data.warning);
    else toast.success(`Dépense ${res.data.number} enregistrée avec son justificatif`);
    router.push(`/app/finance/depenses/${res.data.id}`);
  });

  return (
    <div className="mx-auto grid max-w-lg gap-5">
      <FormAlert message={error} />
      {canAttach && (
        <section aria-label="Photo du justificatif" className="grid gap-3">
          <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={gallery} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          {preview ? (
            <div className="overflow-hidden rounded-xl border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob) d'une photo non encore envoyée */}
              <img src={preview} alt="Justificatif photographié" className="max-h-80 w-full object-contain" />
              <div className="flex items-center justify-between gap-2 border-t bg-card px-3 py-2 text-xs text-muted-foreground">
                <span>{photo ? fmtSize(photo.size) : ""}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => camera.current?.click()}><RefreshCw className="size-4" /> Reprendre</Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => camera.current?.click()} disabled={busy} className="grid min-h-44 place-items-center rounded-xl border-2 border-dashed bg-card p-6 text-center transition-colors active:bg-muted">
              <span className="grid justify-items-center gap-2">
                <span className="grid size-16 place-items-center rounded-full bg-accent text-brand"><Camera className="size-8" aria-hidden="true" /></span>
                <span className="text-base font-semibold">{busy ? "Préparation de la photo…" : "Photographier le justificatif"}</span>
                <span className="text-sm text-muted-foreground">Ticket, facture, reçu : cadrez-le bien à plat, avec de la lumière.</span>
              </span>
            </button>
          )}
          {!preview && <Button type="button" variant="outline" onClick={() => gallery.current?.click()}><ImagePlus className="size-4" /> Choisir une image de la galerie</Button>}
        </section>
      )}

      <Field label="Libellé *" htmlFor="cp-desc"><Input id="cp-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex. Carburant, repas client, fournitures" autoComplete="off" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Montant (${currency}) *`} htmlFor="cp-amount"><Input id="cp-amount" type="number" inputMode="decimal" min={0} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0" /></Field>
        <Field label="Date" htmlFor="cp-date"><Input id="cp-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Catégorie *">
          <Select value={f.categoryId || undefined} onValueChange={(v) => setF({ ...f, categoryId: v })}>
            <SelectTrigger className="w-full" aria-label="Catégorie"><SelectValue placeholder="Choisir…" /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Payé en">
          <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}>
            <SelectTrigger className="w-full" aria-label="Mode de paiement"><SelectValue /></SelectTrigger>
            <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Button size="lg" className="h-12 text-base" disabled={pending || busy || !valid} onClick={submit}>{pending ? "Enregistrement…" : "Enregistrer la dépense"}</Button>
      <p className="text-center text-xs text-muted-foreground">La dépense est créée en brouillon et suit le circuit de validation habituel.</p>
    </div>
  );
}
