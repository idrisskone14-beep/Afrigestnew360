import Link from "next/link";
import { Download, FileText, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TenantContext } from "@/core/tenant/context";
import { fmtDate } from "@/lib/format";
import type { EntityType } from "../schemas";
import { listEntityDocuments } from "../service";
import { UploadDialog } from "./document-dialogs";

export const fmtSize = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);

/**
 * Panneau « Documents » réutilisable dans les fiches (client, fournisseur, salarié, projet, dépense, facture…).
 * Rien n'est affiché si le module est inactif ou si l'utilisateur ne peut pas lire les documents ; le service revérifie
 * en outre le droit de lecture sur l'entité elle-même.
 */
export async function EntityDocuments({ ctx, type, id }: { ctx: TenantContext; type: EntityType; id: string }) {
  if (!ctx.hasModule("documents") || !ctx.can("documents.document.read")) return null;
  const rows = await listEntityDocuments(ctx, type, id);
  const canCreate = ctx.can("documents.document.create");
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base"><Paperclip className="size-4" /> Documents ({rows.length})</CardTitle>
        {canCreate && <UploadDialog entity={{ type, id }} label="Ajouter" />}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun document rattaché.</p> : (
          <ul className="divide-y">
            {rows.map((d) => {
              const v = d.versions[0];
              return (
                <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/documents/${d.id}`} className="block truncate font-medium hover:text-brand">{d.name}</Link>
                    <span className="text-xs text-muted-foreground">v{d.currentVersion}{v ? ` · ${fmtSize(v.size)}` : ""} · {fmtDate(d.updatedAt)}</span>
                  </div>
                  {d.visibility === "RESTRICTED" && <Badge variant="secondary">Restreint</Badge>}
                  <a href={`/api/documents/${d.id}/download`} className="text-muted-foreground hover:text-foreground" aria-label={`Télécharger ${d.name}`}><Download className="size-4" /></a>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
