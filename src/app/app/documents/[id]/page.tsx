import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Archive, ArchiveRestore, Download, Eye, Link2, Trash2, Unlink } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { requireModulePage } from "@/core/tenant/guards";
import { forbidden } from "next/navigation";
import { fmtDate, fmtDateTime, isPast, toInputDate } from "@/lib/format";
import { archiveDocumentAction, deleteDocumentAction, restoreDocumentAction, unlinkDocumentAction } from "@/modules/documents/actions";
import { describeLinks, getDocument, listFolders, shareTargets } from "@/modules/documents/service";
import { EditDocumentDialog, ShareDialog, VersionDialog } from "@/modules/documents/ui/document-dialogs";
import { fmtSize } from "@/modules/documents/ui/entity-documents";

export const metadata: Metadata = { title: "Document" };
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireModulePage("documents");
  if (!ctx.can("documents.document.read")) forbidden();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { doc, canEdit, canManage, canDelete } = await getDocument(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const [links, folders, members] = await Promise.all([
    describeLinks(ctx, doc.links),
    canEdit ? listFolders(ctx) : Promise.resolve([]),
    canManage ? shareTargets(ctx) : Promise.resolve([]),
  ]);
  const names = new Map((await ctx.db.companyMembership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, user: { select: { name: true } } } })).map((m) => [m.userId, m.user.name]));
  const archived = doc.status === "ARCHIVED";
  const current = doc.versions[0];

  return (
    <>
      <PageHeader
        title={doc.name}
        description={doc.description ?? undefined}
        breadcrumbs={[{ label: "Documents", href: "/app/documents" }, ...(doc.folder ? [{ label: doc.folder.name, href: `/app/documents?dossier=${doc.folder.id}` }] : []), { label: doc.name }]}
        actions={
          <>
            {current && INLINE.has(current.mimeType) && <a href={`/api/documents/${id}/download?inline=1`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"><Eye className="size-4" /> Aperçu</a>}
            <a href={`/api/documents/${id}/download`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"><Download className="size-4" /> Télécharger</a>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={archived ? "secondary" : "default"}>{archived ? "Archivé" : "Actif"}</Badge>
        <Badge variant="outline">{doc.visibility === "RESTRICTED" ? "Restreint" : "Entreprise"}</Badge>
        {doc.expiresAt && <Badge variant={isPast(doc.expiresAt) ? "destructive" : "outline"}>{isPast(doc.expiresAt) ? "Expiré le" : "Expire le"} {fmtDate(doc.expiresAt)}</Badge>}
        {doc.tags.map((t) => <Link key={t} href={`/app/documents?etiquette=${encodeURIComponent(t)}`}><Badge variant="outline">#{t}</Badge></Link>)}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canEdit && !archived && <VersionDialog id={id} />}
          {canEdit && <EditDocumentDialog doc={{ id, name: doc.name, description: doc.description, folderId: doc.folderId, visibility: doc.visibility, tags: doc.tags, expiresAt: toInputDate(doc.expiresAt) }} folders={folders} canChangeVisibility={canManage || canDelete} />}
          {canManage && <ShareDialog id={id} members={members} shares={doc.shares} />}
          {canEdit && <ActionButton action={archived ? restoreDocumentAction : archiveDocumentAction} input={{ id }} size="sm" label={archived ? "Restaurer" : "Archiver"} icon={archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} success={archived ? "Document restauré" : "Document archivé"} />}
          {canDelete && <ActionButton action={deleteDocumentAction} input={{ id }} variant="destructive" size="sm" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/documents" success="Document supprimé" confirm={{ title: "Supprimer ce document ?", description: "Toutes les versions seront définitivement supprimées.", confirmLabel: "Supprimer" }} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden p-0">
          <CardHeader><CardTitle className="text-base">Versions ({doc.versions.length})</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Version</TableHead><TableHead>Fichier</TableHead><TableHead className="hidden sm:table-cell">Taille</TableHead><TableHead>Ajoutée</TableHead><TableHead className="w-12"><span className="sr-only">Télécharger</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {doc.versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">v{v.version}{v.version === doc.currentVersion && <Badge className="ml-2" variant="secondary">actuelle</Badge>}</TableCell>
                  <TableCell className="text-sm">
                    {v.fileName}
                    {v.comment && <div className="text-xs text-muted-foreground">{v.comment}</div>}
                    <div className="font-mono text-[10px] text-muted-foreground" title="Empreinte SHA-256 du contenu">SHA-256 {v.sha256.slice(0, 16)}…</div>
                  </TableCell>
                  <TableCell className="hidden text-sm tabular sm:table-cell">{fmtSize(v.size)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDateTime(v.createdAt)}<div className="text-xs">{names.get(v.uploadedById) ?? ""}</div></TableCell>
                  <TableCell><a href={`/api/documents/${id}/download?v=${v.version}`} aria-label={`Télécharger la version ${v.version}`} className="text-muted-foreground hover:text-foreground"><Download className="size-4" /></a></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="size-4" /> Liens ({links.length})</CardTitle></CardHeader>
            <CardContent>
              {links.length === 0 ? <p className="text-sm text-muted-foreground">Ce document n&apos;est lié à aucun élément. Ajoutez-le depuis la fiche d&apos;un client, d&apos;une facture, d&apos;un salarié ou d&apos;un projet.</p> : (
                <ul className="divide-y text-sm">
                  {links.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0"><span className="text-xs text-muted-foreground">{l.type}</span><div className="truncate">{l.href ? <Link href={l.href} className="hover:text-brand">{l.label}</Link> : l.label}</div></div>
                      {canEdit && <ActionButton action={unlinkDocumentAction} input={{ id: l.id }} variant="ghost" size="icon" label="" ariaLabel={`Retirer le lien avec ${l.label}`} icon={<Unlink className="size-4" />} success="Lien retiré" />}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {canManage && (
            <Card>
              <CardHeader><CardTitle className="text-base">Partage ({doc.shares.length})</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {doc.shares.length === 0 ? <p className="text-muted-foreground">{doc.visibility === "RESTRICTED" ? "Personne d'autre n'a accès." : "Visible selon les droits de chacun."}</p> : (
                  <ul className="space-y-1">{doc.shares.map((s) => <li key={s.id}>{names.get(s.userId) ?? "Utilisateur"} — <span className="text-muted-foreground">{s.canEdit ? "modification" : "lecture"}</span></li>)}</ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
