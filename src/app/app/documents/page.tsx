import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText, Folder, FolderOpen, Trash2 } from "lucide-react";
import { forbidden } from "next/navigation";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { ListToolbar } from "@/components/app/list-kit";
import { ActionButton } from "@/components/app/action-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate, isPast } from "@/lib/format";
import { PAGE_SIZE, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import { deleteFolderAction } from "@/modules/documents/actions";
import { listDocuments, listFolders } from "@/modules/documents/service";
import { FolderDialog, UploadDialog } from "@/modules/documents/ui/document-dialogs";
import { fmtSize } from "@/modules/documents/ui/entity-documents";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("documents");
  if (!ctx.can("documents.document.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const folders = await listFolders(ctx);
  const archived = param(sp, "statut") === "archives";
  const expiring = param(sp, "statut") === "expire";
  const wanted = param(sp, "dossier");
  const folder = folders.find((f) => f.id === wanted);
  // sans dossier choisi : tout ce qui est à la racine ; la recherche porte toujours sur l'ensemble
  const { rows, total } = await listDocuments(ctx, { q: lp.q || undefined, folderId: folder ? folder.id : null, status: archived ? "ARCHIVED" : "ACTIVE", expiring, tag: param(sp, "etiquette"), skip: lp.skip, take: lp.take });
  const canCreate = ctx.can("documents.document.create");
  const canDeleteFolder = ctx.can("documents.document.delete");
  const keep = (extra: Record<string, string>) => { const p = new URLSearchParams({ ...(archived ? { statut: "archives" } : {}), ...(expiring ? { statut: "expire" } : {}), ...extra }); return `/app/documents${p.size ? `?${p}` : ""}`; };

  const children = (parentId: string | null) => folders.filter((f) => f.parentId === parentId);
  const renderTree = (parentId: string | null, depth = 0): React.ReactNode => children(parentId).map((f) => (
    <li key={f.id}>
      <div className={cn("group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted", folder?.id === f.id && "bg-muted font-medium")} style={{ paddingLeft: 8 + depth * 14 }}>
        <Link href={keep({ dossier: f.id })} className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
          {folder?.id === f.id ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{f.name}</span><span className="text-xs text-muted-foreground">{f._count.documents}</span>
        </Link>
        {canCreate && <FolderDialog rename={{ id: f.id, name: f.name }} />}
        {canDeleteFolder && <ActionButton action={deleteFolderAction} input={{ id: f.id }} variant="ghost" size="icon" label="" ariaLabel={`Supprimer le dossier ${f.name}`} icon={<Trash2 className="size-4" />} success="Dossier supprimé" confirm={{ title: `Supprimer le dossier « ${f.name} » ?`, description: "Le dossier doit être vide.", confirmLabel: "Supprimer" }} />}
      </div>
      <ul>{renderTree(f.id, depth + 1)}</ul>
    </li>
  ));

  return (
    <>
      <PageHeader title="Documents" description="Dossiers, versions, étiquettes, liens vers les clients, factures, salariés et projets, partage interne." />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside aria-label="Dossiers" className="space-y-3">
          <nav>
            <ul>
              <li><Link href={keep({})} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted", !folder && "bg-muted font-medium")}><Folder className="size-4" /> Racine</Link></li>
              {renderTree(null)}
            </ul>
          </nav>
          {canCreate && <FolderDialog folders={folders} parentId={folder?.id} />}
          <div className="border-t pt-3 text-sm">
            <Link href={archived || expiring ? "/app/documents" : "/app/documents?statut=archives"} className="block text-muted-foreground hover:text-foreground">{archived || expiring ? "← Documents actifs" : "Voir les archives"}</Link>
            {!archived && !expiring && <Link href="/app/documents?statut=expire" className="mt-1 block text-muted-foreground hover:text-foreground">Documents à renouveler</Link>}
          </div>
        </aside>
        <section>
          <ListToolbar placeholder="Rechercher (nom, description, étiquette)…">
            {canCreate && !archived && <UploadDialog folders={folders} folderId={folder?.id} />}
          </ListToolbar>
          {lp.q && <p className="mb-2 text-sm text-muted-foreground">Recherche dans l&apos;ensemble des dossiers.</p>}
          {archived && <p className="mb-2 text-sm text-muted-foreground">Documents archivés.</p>}
          {expiring && <p className="mb-2 text-sm text-muted-foreground">Documents expirés ou expirant sous 30 jours.</p>}
          {rows.length === 0 ? <EmptyState icon={<FileText className="size-8" />} title={lp.q ? "Aucun résultat" : archived ? "Aucun document archivé" : "Aucun document ici"} description={lp.q ? "Essayez un autre terme." : canCreate ? "Ajoutez un premier document ou créez un dossier." : undefined} /> : (
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Nom</TableHead><TableHead className="hidden md:table-cell">Dossier</TableHead><TableHead className="hidden sm:table-cell">Taille</TableHead><TableHead>Modifié</TableHead><TableHead className="w-12"><span className="sr-only">Télécharger</span></TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link href={`/app/documents/${d.id}`} className="font-medium hover:text-brand">{d.name}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">v{d.currentVersion}</span>
                          {d.visibility === "RESTRICTED" && <Badge variant="secondary">Restreint</Badge>}
                          {d.expiresAt && <Badge variant={isPast(d.expiresAt) ? "destructive" : "outline"}>{isPast(d.expiresAt) ? "Expiré" : "Expire"} {fmtDate(d.expiresAt)}</Badge>}
                          {d.links.length > 0 && <Badge variant="outline">{d.links.length} lien{d.links.length > 1 ? "s" : ""}</Badge>}
                          {d.tags.slice(0, 3).map((t) => <Link key={t} href={keep({ etiquette: t })}><Badge variant="outline">#{t}</Badge></Link>)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{d.folder?.name ?? "—"}</TableCell>
                      <TableCell className="hidden text-sm tabular sm:table-cell">{d.versions[0] ? fmtSize(d.versions[0].size) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(d.updatedAt)}</TableCell>
                      <TableCell><a href={`/api/documents/${d.id}/download`} aria-label={`Télécharger ${d.name}`} className="text-muted-foreground hover:text-foreground"><Download className="size-4" /></a></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/documents" searchParams={sp} />
        </section>
      </div>
    </>
  );
}
