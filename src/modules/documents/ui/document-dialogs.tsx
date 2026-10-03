"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FolderPlus, Pencil, Share2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert } from "@/components/app/form-kit";
import type { ActionResult } from "@/core/errors";
import { createFolderAction, renameFolderAction, shareDocumentAction, unshareDocumentAction, updateDocumentAction, uploadDocumentAction, uploadVersionAction } from "../actions";
import type { EntityType } from "../schemas";

const NONE = "__none";
const MAX_MB = 8;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.txt,.csv";
const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);
export interface FolderOption { id: string; name: string; parentId: string | null }

/** « Parent / Enfant » pour les listes de dossiers. */
export function folderPaths(folders: FolderOption[]): { id: string; label: string }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = (f: FolderOption): string => { const seen = new Set<string>(); let cur: FolderOption | undefined = f; const parts: string[] = []; while (cur && !seen.has(cur.id)) { seen.add(cur.id); parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; } return parts.join(" / "); };
  return folders.map((f) => ({ id: f.id, label: path(f) })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

function FolderSelect({ value, onChange, folders }: { value: string; onChange: (v: string) => void; folders: FolderOption[] }) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className="w-full" aria-label="Dossier"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value={NONE}>Racine (sans dossier)</SelectItem>{folderPaths(folders).map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function useDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) return setError(errText(r.error));
    toast.success(success);
    setOpen(false); after?.(); router.refresh();
  });
  return { open, setOpen, pending, error, setError, run };
}

// ── Nouveau document ──────────────────────────────────────────

export function UploadDialog({ folders = [], folderId = "", entity, label = "Ajouter un document" }: { folders?: FolderOption[]; folderId?: string; entity?: { type: EntityType; id: string }; label?: string }) {
  const d = useDialog();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ name: "", description: "", tags: "", visibility: "COMPANY", folder: folderId, expiresAt: "" });
  const [picked, setPicked] = useState<File | null>(null);

  const pick = (x: File | undefined) => {
    d.setError(null);
    if (x && x.size > MAX_MB * 1024 * 1024) { d.setError(`Le fichier dépasse ${MAX_MB} Mo.`); return setPicked(null); }
    setPicked(x ?? null);
    if (x && !f.name) setF((p) => ({ ...p, name: x.name.replace(/\.[^.]+$/, "") }));
  };
  const submit = () => {
    if (!picked) return d.setError("Choisissez un fichier.");
    const fd = new FormData();
    fd.set("file", picked); fd.set("name", f.name); fd.set("description", f.description); fd.set("tags", f.tags); fd.set("visibility", f.visibility); fd.set("folderId", f.folder); fd.set("expiresAt", f.expiresAt);
    if (entity) { fd.set("entityType", entity.type); fd.set("entityId", entity.id); }
    d.run(() => uploadDocumentAction(fd), "Document ajouté", () => { setPicked(null); setF({ name: "", description: "", tags: "", visibility: "COMPANY", folder: folderId, expiresAt: "" }); });
  };
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) { d.setError(null); setF((p) => ({ ...p, folder: folderId })); } }}>
      <DialogTrigger asChild><Button size="sm"><Upload className="size-4" /> {label}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Ajouter un document</DialogTitle><DialogDescription>PDF, images, Word, Excel, PowerPoint, TXT ou CSV — {MAX_MB} Mo maximum. Le type réel du fichier est vérifié par le serveur.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={d.error} />
          <Field label="Fichier *" htmlFor="doc-file">
            <Input id="doc-file" ref={file} type="file" accept={ACCEPT} onChange={(e) => pick(e.target.files?.[0])} />
          </Field>
          <Field label="Nom *" htmlFor="doc-name"><Input id="doc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          {!entity && <Field label="Dossier"><FolderSelect value={f.folder} onChange={(v) => setF({ ...f, folder: v })} folders={folders} /></Field>}
          <Field label="Description" htmlFor="doc-desc"><Textarea id="doc-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Étiquettes" htmlFor="doc-tags" hint="Séparées par des virgules."><Input id="doc-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
          <Field label="Échéance" htmlFor="doc-exp" hint="Contrat, assurance, certificat… vous serez alerté 30 jours avant."><Input id="doc-exp" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
          <Field label="Visibilité" hint={f.visibility === "RESTRICTED" ? "Visible de vous, des administrateurs et des personnes avec qui vous le partagez." : "Visible des membres autorisés à lire les documents (et les éléments liés)."}>
            <Select value={f.visibility} onValueChange={(v) => setF({ ...f, visibility: v })}>
              <SelectTrigger className="w-full" aria-label="Visibilité"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="COMPANY">Entreprise</SelectItem><SelectItem value="RESTRICTED">Restreint (partage explicite)</SelectItem></SelectContent>
            </Select>
          </Field>
          <Button disabled={d.pending || !picked || !f.name.trim()} onClick={submit}>{d.pending ? "Envoi…" : "Téléverser"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Nouvelle version ──────────────────────────────────────────

export function VersionDialog({ id }: { id: string }) {
  const d = useDialog();
  const [picked, setPicked] = useState<File | null>(null);
  const [comment, setComment] = useState("");
  const submit = () => {
    if (!picked) return d.setError("Choisissez un fichier.");
    const fd = new FormData();
    fd.set("id", id); fd.set("file", picked); fd.set("comment", comment);
    d.run(() => uploadVersionAction(fd), "Nouvelle version ajoutée", () => { setPicked(null); setComment(""); });
  };
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) d.setError(null); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Upload className="size-4" /> Nouvelle version</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle version</DialogTitle><DialogDescription>La version actuelle reste consultable dans l&apos;historique.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={d.error} />
          <Field label="Fichier *" htmlFor="ver-file"><Input id="ver-file" type="file" accept={ACCEPT} onChange={(e) => { const x = e.target.files?.[0]; if (x && x.size > MAX_MB * 1024 * 1024) { d.setError(`Le fichier dépasse ${MAX_MB} Mo.`); setPicked(null); } else { d.setError(null); setPicked(x ?? null); } }} /></Field>
          <Field label="Commentaire" htmlFor="ver-comment"><Input id="ver-comment" value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} /></Field>
          <Button disabled={d.pending || !picked} onClick={submit}>{d.pending ? "Envoi…" : "Ajouter la version"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Modification des informations ─────────────────────────────

export function EditDocumentDialog({ doc, folders, canChangeVisibility }: { doc: { id: string; name: string; description: string | null; folderId: string | null; visibility: string; tags: string[]; expiresAt: string }; folders: FolderOption[]; canChangeVisibility: boolean }) {
  const d = useDialog();
  const [f, setF] = useState({ name: doc.name, description: doc.description ?? "", tags: doc.tags.join(", "), visibility: doc.visibility, folder: doc.folderId ?? "", expiresAt: doc.expiresAt });
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) { d.setError(null); setF({ name: doc.name, description: doc.description ?? "", tags: doc.tags.join(", "), visibility: doc.visibility, folder: doc.folderId ?? "", expiresAt: doc.expiresAt }); } }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Pencil className="size-4" /> Modifier</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Modifier le document</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={d.error} />
          <Field label="Nom *" htmlFor="ed-name"><Input id="ed-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Dossier"><FolderSelect value={f.folder} onChange={(v) => setF({ ...f, folder: v })} folders={folders} /></Field>
          <Field label="Description" htmlFor="ed-desc"><Textarea id="ed-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Étiquettes" htmlFor="ed-tags"><Input id="ed-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
          <Field label="Échéance" htmlFor="ed-exp"><Input id="ed-exp" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
          {canChangeVisibility && (
            <Field label="Visibilité">
              <Select value={f.visibility} onValueChange={(v) => setF({ ...f, visibility: v })}>
                <SelectTrigger className="w-full" aria-label="Visibilité"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="COMPANY">Entreprise</SelectItem><SelectItem value="RESTRICTED">Restreint (partage explicite)</SelectItem></SelectContent>
              </Select>
            </Field>
          )}
          <Button disabled={d.pending || !f.name.trim()} onClick={() => d.run(() => updateDocumentAction({ id: doc.id, name: f.name, description: f.description, tags: f.tags, folderId: f.folder, visibility: f.visibility as "COMPANY", expiresAt: f.expiresAt }), "Document mis à jour")}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Partage ───────────────────────────────────────────────────

export function ShareDialog({ id, members, shares }: { id: string; members: { id: string; name: string; email: string }[]; shares: { userId: string; canEdit: boolean }[] }) {
  const d = useDialog();
  const router = useRouter();
  const [user, setUser] = useState("");
  const [edit, setEdit] = useState("read");
  const name = (uid: string) => members.find((m) => m.id === uid)?.name ?? "Utilisateur";
  const remove = async (userId: string) => { const r = await unshareDocumentAction({ id, userId }); if (!r.ok) return d.setError(errText(r.error)); toast.success("Partage retiré"); router.refresh(); };
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) d.setError(null); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Share2 className="size-4" /> Partager</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Partager le document</DialogTitle><DialogDescription>Seuls les membres actifs de l&apos;entreprise peuvent recevoir un partage.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={d.error} />
          {shares.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {shares.map((s) => (
                <li key={s.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>{name(s.userId)} <Badge variant="secondary">{s.canEdit ? "Modification" : "Lecture"}</Badge></span>
                  <Button size="icon" variant="ghost" aria-label={`Retirer le partage avec ${name(s.userId)}`} onClick={() => remove(s.userId)}><Trash2 className="size-4" /></Button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Personne">
            <Select value={user || NONE} onValueChange={(v) => setUser(v === NONE ? "" : v)}>
              <SelectTrigger className="w-full" aria-label="Personne"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>— Choisir —</SelectItem>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.email})</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Droit">
            <Select value={edit} onValueChange={setEdit}>
              <SelectTrigger className="w-full" aria-label="Droit"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="read">Lecture seule</SelectItem><SelectItem value="edit">Lecture et modification</SelectItem></SelectContent>
            </Select>
          </Field>
          <Button disabled={d.pending || !user} onClick={() => d.run(() => shareDocumentAction({ id, userId: user, canEdit: edit === "edit" }), "Document partagé", () => setUser(""))}>Partager</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Dossiers ──────────────────────────────────────────────────

export function FolderDialog({ folders, parentId, rename }: { folders?: FolderOption[]; parentId?: string; rename?: { id: string; name: string } }) {
  const d = useDialog();
  const [name, setName] = useState(rename?.name ?? "");
  const [parent, setParent] = useState(parentId ?? "");
  return (
    <Dialog open={d.open} onOpenChange={(o) => { d.setOpen(o); if (o) { d.setError(null); setName(rename?.name ?? ""); setParent(parentId ?? ""); } }}>
      <DialogTrigger asChild>
        {rename ? <Button size="icon" variant="ghost" aria-label={`Renommer le dossier ${rename.name}`}><Pencil className="size-4" /></Button> : <Button size="sm" variant="outline"><FolderPlus className="size-4" /> Nouveau dossier</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{rename ? "Renommer le dossier" : "Nouveau dossier"}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={d.error} />
          <Field label="Nom *" htmlFor="fd-name"><Input id="fd-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          {!rename && folders && <Field label="Dossier parent"><FolderSelect value={parent} onChange={setParent} folders={folders} /></Field>}
          <Button disabled={d.pending || !name.trim()} onClick={() => d.run(() => (rename ? renameFolderAction({ id: rename.id, name }) : createFolderAction({ name, parentId: parent })), rename ? "Dossier renommé" : "Dossier créé")}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
