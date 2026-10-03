"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/core/errors";
import { Field, FormAlert } from "./form-kit";

export interface FieldSpec {
  name: string;
  label: string;
  kind?: "text" | "number" | "date" | "datetime" | "time" | "textarea" | "select" | "switch";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  step?: string;
  /** Pleine largeur dans la grille à deux colonnes. */
  wide?: boolean;
  /** Option « aucune valeur » proposée dans une liste (valeur vide). */
  emptyLabel?: string;
  maxLength?: number;
}
export type Values = Record<string, string | boolean>;

const NONE = "__none";
const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

/**
 * Boîte de dialogue de saisie pilotée par une liste de champs. Les valeurs sont des textes : le serveur convertit et valide
 * (schémas Zod), les erreurs reviennent dans le dialogue. Le composant ne contient aucune règle métier.
 */
export function EntityDialog({ title, description, fields, initial, trigger, submitLabel = "Enregistrer", success = "Enregistré", onSubmit, onDone, wide }: {
  title: string; description?: string; fields: FieldSpec[]; initial: Values; trigger: React.ReactNode; submitLabel?: string; success?: string;
  onSubmit: (v: Values) => Promise<ActionResult<unknown>>; onDone?: () => void; wide?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Values>(initial);
  const missing = fields.some((f) => f.required && f.kind !== "switch" && !String(v[f.name] ?? "").trim());
  const submit = () => start(async () => {
    setError(null);
    const res = await onSubmit(v);
    if (!res.ok) return setError(errText(res.error));
    toast.success(success);
    setOpen(false); onDone?.(); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setV(initial); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={wide ? "max-h-[90vh] overflow-y-auto sm:max-w-2xl" : "max-h-[90vh] overflow-y-auto"}>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!missing && !pending) submit(); }}>
          <FormAlert message={error} />
          <div className={wide ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
            {fields.map((f) => {
              const id = `f-${f.name}`;
              const label = `${f.label}${f.required ? " *" : ""}`;
              const span = f.wide || f.kind === "textarea" ? "sm:col-span-2" : undefined;
              if (f.kind === "switch") return <label key={f.name} className={`flex items-center gap-2 text-sm ${span ?? ""}`}><Switch checked={Boolean(v[f.name])} onCheckedChange={(c) => setV({ ...v, [f.name]: c })} /> {f.label}</label>;
              if (f.kind === "select") {
                return (
                  <Field key={f.name} label={label} className={span} hint={f.hint}>
                    <Select value={String(v[f.name] ?? "") || NONE} onValueChange={(x) => setV({ ...v, [f.name]: x === NONE ? "" : x })}>
                      <SelectTrigger className="w-full" aria-label={f.label}><SelectValue /></SelectTrigger>
                      <SelectContent>{(f.emptyLabel !== undefined || !f.required) && <SelectItem value={NONE}>{f.emptyLabel ?? "— Aucun —"}</SelectItem>}{f.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                );
              }
              if (f.kind === "textarea") return <Field key={f.name} label={label} htmlFor={id} className={span} hint={f.hint}><Textarea id={id} rows={3} maxLength={f.maxLength} value={String(v[f.name] ?? "")} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} /></Field>;
              const type = f.kind === "number" ? "number" : f.kind === "date" ? "date" : f.kind === "datetime" ? "datetime-local" : f.kind === "time" ? "time" : "text";
              return <Field key={f.name} label={label} htmlFor={id} className={span} hint={f.hint}><Input id={id} type={type} step={f.step ?? (f.kind === "number" ? "any" : undefined)} min={f.kind === "number" ? 0 : undefined} maxLength={f.maxLength} value={String(v[f.name] ?? "")} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} /></Field>;
            })}
          </div>
          <Button type="submit" disabled={pending || missing}>{pending ? "Enregistrement…" : submitLabel}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Convertit les valeurs du formulaire en objet d'entrée (les booléens restent des booléens, les textes sont passés tels quels). */
export const toInput = (v: Values) => v as Record<string, string | boolean>;
