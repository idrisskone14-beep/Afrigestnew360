"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Mail, Phone, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, runAction } from "@/components/app/form-kit";
import { addContactAction, deleteContactAction, updateContactAction } from "../actions";

interface ContactRow { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }

export function ContactsPanel({ customerId, contacts, canEdit }: { customerId: string; contacts: ContactRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ContactRow | "new" | null>(null);
  const [form, setForm] = useState({ name: "", title: "", email: "", phone: "", isPrimary: false });
  const [error, setError] = useState<string | null>(null);

  const open = (c: ContactRow | "new") => {
    setEditing(c); setError(null);
    setForm(c === "new" ? { name: "", title: "", email: "", phone: "", isPrimary: contacts.length === 0 } : { name: c.name, title: c.title ?? "", email: c.email ?? "", phone: c.phone ?? "", isPrimary: c.isPrimary });
  };

  const save = () => start(async () => {
    setError(null);
    const res = editing === "new"
      ? await addContactAction({ customerId, ...form })
      : await updateContactAction({ id: (editing as ContactRow).id, ...form });
    if (!res.ok) return setError(res.error.fieldErrors ? Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message : res.error.message);
    toast.success("Contact enregistré");
    setEditing(null);
    router.refresh();
  });

  return (
    <div className="space-y-3">
      {canEdit && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => open("new")}><Plus className="size-4" /> Ajouter un contact</Button></div>}
      {contacts.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun contact enregistré.</p> : (
        <ul className="divide-y rounded-xl border bg-card">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">{c.name}{c.isPrimary && <Badge variant="secondary"><Star className="size-3" /> Principal</Badge>}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  {c.title && <span>{c.title}</span>}
                  {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="size-3" />{c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="size-3" />{c.phone}</a>}
                </p>
              </div>
              {canEdit && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => open(c)}>Modifier</Button>
                  <Button variant="ghost" size="icon" aria-label={`Supprimer ${c.name}`} disabled={pending} onClick={() => start(async () => { const r = await runAction(deleteContactAction({ id: c.id }), { success: "Contact supprimé" }); if (r.ok) router.refresh(); })}><Trash2 className="size-4 text-destructive" /></Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing === "new" ? "Nouveau contact" : "Modifier le contact"}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <FormAlert message={error} />
            <Field label="Nom *" htmlFor="ct-name"><Input id="ct-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <Field label="Fonction" htmlFor="ct-title"><Input id="ct-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="E-mail" htmlFor="ct-email"><Input id="ct-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Téléphone" htmlFor="ct-phone"><Input id="ct-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isPrimary} onCheckedChange={(v) => setForm({ ...form, isPrimary: v === true })} /> Contact principal</label>
            <Button disabled={pending || form.name.trim().length < 2} onClick={save}>Enregistrer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
