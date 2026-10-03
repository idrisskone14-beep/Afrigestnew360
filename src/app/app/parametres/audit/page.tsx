import type { Metadata } from "next";
import Link from "next/link";
import { Download, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { PAGE_SIZE, buildQuery, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { parseAuditFilters } from "@/modules/audit/params";
import { auditFacets, listAudit } from "@/modules/audit/service";

export const metadata: Metadata = { title: "Paramètres — Journal d'audit" };

const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";

type Json = Record<string, unknown> | null;
const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Champs modifiés entre l'ancienne et la nouvelle valeur ; à défaut, toutes les valeurs connues. */
function changes(before: Json, after: Json) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.map((k) => ({ k, b: before?.[k], a: after?.[k] })).filter((c) => fmt(c.b) !== fmt(c.a));
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("audit.log.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const filters = parseAuditFilters((k) => param(sp, k));
  const [{ rows, total }, facets] = await Promise.all([listAudit(ctx, filters, { skip: lp.skip, take: lp.take }), auditFacets(ctx)]);
  const exportQuery = buildQuery(sp, { page: undefined, format: "csv" });
  const exportXlsx = buildQuery(sp, { page: undefined, format: "xlsx" });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Toutes les actions sensibles de l&apos;entreprise, en lecture seule : personne ne peut modifier ni supprimer une ligne du journal.</p>
      <form method="get" className="flex flex-wrap items-end gap-3" role="search" aria-label="Filtres du journal d'audit">
        <label className="grid gap-1 text-xs text-muted-foreground">Recherche<Input name="q" defaultValue={lp.q} placeholder="Texte, identifiant…" className="h-9 w-56" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Utilisateur
          <select name="utilisateur" defaultValue={filters.userId ?? ""} className={selectCls}><option value="">Tous</option>{facets.users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Ressource
          <select name="ressource" defaultValue={filters.resource ?? ""} className={selectCls}><option value="">Toutes</option>{facets.resources.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Action (préfixe)<Input name="action" defaultValue={filters.action} placeholder="invoice., hr.…" className="h-9 w-36" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Du<Input type="date" name="du" defaultValue={param(sp, "du")} className="h-9" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Au<Input type="date" name="au" defaultValue={param(sp, "au")} className="h-9" /></label>
        <Button type="submit" size="sm">Filtrer</Button>
        <Button asChild variant="ghost" size="sm"><Link href="/app/parametres/audit">Réinitialiser</Link></Button>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm"><a href={`/api/export/audit${exportQuery}`}><Download className="size-4" /> CSV</a></Button>
          <Button asChild variant="outline" size="sm"><a href={`/api/export/audit${exportXlsx}`}><Download className="size-4" /> Excel</a></Button>
        </div>
      </form>
      {rows.length === 0 ? <EmptyState icon={<ScrollText className="size-8" />} title="Aucune entrée" description="Aucune action ne correspond à ces filtres." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Utilisateur</TableHead><TableHead>Action</TableHead><TableHead>Détail</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const diff = changes(r.before as Json, r.after as Json);
                return (
                  <TableRow key={r.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDateTime(r.createdAt)}</TableCell>
                    <TableCell className="text-sm">{r.userLabel ?? "Système"}{r.ip && <div className="text-xs text-muted-foreground">{r.ip}</div>}</TableCell>
                    <TableCell className="text-sm"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.action}</code><div className="mt-0.5 text-xs text-muted-foreground">{r.resource}{r.resourceId ? ` · ${r.resourceId.slice(0, 8)}…` : ""}</div></TableCell>
                    <TableCell className="text-sm">
                      {r.summary ?? "—"}
                      {(diff.length > 0 || r.userAgent) && (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Voir le détail</summary>
                          {diff.length > 0 && (
                            <table className="mt-1 w-full text-left">
                              <thead><tr className="text-muted-foreground"><th className="pr-3 font-medium">Champ</th><th className="pr-3 font-medium">Avant</th><th className="font-medium">Après</th></tr></thead>
                              <tbody>{diff.map((c) => <tr key={c.k}><td className="pr-3 font-mono">{c.k}</td><td className="pr-3 break-all">{fmt(c.b)}</td><td className="break-all">{fmt(c.a)}</td></tr>)}</tbody>
                            </table>
                          )}
                          {r.userAgent && <p className="mt-1 break-all text-muted-foreground">{r.userAgent}</p>}
                        </details>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/parametres/audit" searchParams={sp} />
    </div>
  );
}
