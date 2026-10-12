"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import { invoiceShareLinkAction, quoteShareLinkAction, sendInvoiceAction, sendQuoteAction } from "../actions";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

/** Fenêtre d'envoi d'un devis ou d'une facture par e-mail : message modifiable, lien public et PDF en pièce jointe. */
export function SendDocumentDialog({ kind, id, defaults, resend = false }: {
  kind: "quote" | "invoice"; id: string; defaults: { to: string; subject: string; message: string }; resend?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState(defaults.to);
  const [subject, setSubject] = useState(defaults.subject);
  const [message, setMessage] = useState(defaults.message);
  const [attachPdf, setAttachPdf] = useState(true);

  const submit = () => start(async () => {
    setError(null);
    const res = await (kind === "quote" ? sendQuoteAction : sendInvoiceAction)({ id, to, subject, message, attachPdf });
    if (!res.ok) return setError(errText(res.error));
    toast.success(`${kind === "quote" ? "Devis" : "Facture"} envoyé${kind === "quote" ? "" : "e"} à ${to}`);
    setOpen(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant={resend ? "outline" : "default"}><Mail className="size-4" /> {resend ? "Renvoyer par e-mail" : "Envoyer par e-mail"}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Envoyer {kind === "quote" ? "le devis" : "la facture"} au client</DialogTitle>
          <DialogDescription>Le client reçoit votre message, un lien pour {kind === "quote" ? "consulter et accepter le devis en ligne" : "consulter la facture"} et le PDF en pièce jointe.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Destinataire *" htmlFor="sd-to" hint={defaults.to ? undefined : "Ce client n'a pas d'adresse e-mail : saisissez-la ici (elle n'est pas enregistrée sur sa fiche)."}><Input id="sd-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@exemple.com" /></Field>
          <Field label="Objet *" htmlFor="sd-subject"><Input id="sd-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Message *" htmlFor="sd-message"><Textarea id="sd-message" rows={9} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={attachPdf} onCheckedChange={(v) => setAttachPdf(v === true)} /> Joindre le PDF</label>
          <Button disabled={pending || !to.trim() || !subject.trim() || !message.trim()} onClick={submit}>{pending ? "Envoi…" : "Envoyer"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Copie le lien public du document (créé à la demande). */
export function CopyShareLinkButton({ kind, id }: { kind: "quote" | "invoice"; id: string }) {
  const [pending, start] = useTransition();
  const copy = () => start(async () => {
    const res = await (kind === "quote" ? quoteShareLinkAction : invoiceShareLinkAction)({ id });
    if (!res.ok) return void toast.error(errText(res.error));
    try {
      await navigator.clipboard.writeText(res.data.url);
      toast.success("Lien copié : il ouvre ce document sans connexion");
    } catch {
      toast.message("Copiez ce lien", { description: res.data.url });
    }
  });
  return <Button variant="outline" disabled={pending} onClick={copy}><Link2 className="size-4" /> Copier le lien</Button>;
}
