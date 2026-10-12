"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import { respondToQuoteAction } from "./actions";

/** Réponse du client au devis : accepter ou refuser, avec son nom et un commentaire facultatif. */
export function RespondPanel({ token, number }: { token: string; number: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"ACCEPT" | "REJECT" | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => start(async () => {
    if (!mode) return;
    setError(null);
    const res = await respondToQuoteAction({ token, decision: mode, name, note });
    if (!res.ok) return setError(res.error.fieldErrors?.name?.[0] ?? res.error.message);
    router.refresh();
  });

  return (
    <section aria-label="Votre réponse" className="rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Votre réponse au devis {number}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Votre réponse est transmise immédiatement à l&apos;entreprise.</p>
      {!mode ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button size="lg" onClick={() => setMode("ACCEPT")}><CheckCircle2 className="size-5" /> Accepter le devis</Button>
          <Button size="lg" variant="outline" onClick={() => setMode("REJECT")}><XCircle className="size-5" /> Refuser</Button>
        </div>
      ) : (
        <div className="mt-4 grid max-w-md gap-4">
          <FormAlert message={error} />
          <Field label="Votre nom *" htmlFor="rp-name"><Input id="rp-name" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} placeholder="Nom et prénom" /></Field>
          <Field label={mode === "ACCEPT" ? "Commentaire (facultatif)" : "Motif du refus (facultatif)"} htmlFor="rp-note"><Textarea id="rp-note" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-3">
            <Button onClick={submit} disabled={pending || name.trim().length < 2} variant={mode === "ACCEPT" ? "default" : "destructive"}>
              {pending ? "Envoi…" : mode === "ACCEPT" ? "Confirmer l'acceptation" : "Confirmer le refus"}
            </Button>
            <Button variant="ghost" onClick={() => { setMode(null); setError(null); }} disabled={pending}>Retour</Button>
          </div>
          {mode === "ACCEPT" && <p className="text-xs text-muted-foreground">En acceptant, vous vous engagez sur les conditions de ce devis.</p>}
        </div>
      )}
    </section>
  );
}
