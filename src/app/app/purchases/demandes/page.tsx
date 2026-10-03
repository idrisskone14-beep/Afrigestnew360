import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listRequests } from "@/modules/purchasing/procurement";

export const metadata: Metadata = { title: "Demandes d'achat" };
const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ORDERED", "CANCELLED"] as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("purchases.request.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const mine = enumParam(sp, "auteur", ["moi"] as const) === "moi";
  const { rows, total } = await listRequests(ctx, { q: lp.q, status, mine, skip: lp.skip, take: lp.take });
  const names = new Map((await ctx.db.companyMembership.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.requesterId))] } }, select: { userId: true, user: { select: { name: true } } } })).map((m) => [m.userId, m.user.name]));
  return (
    <>
      <ListToolbar placeholder="N° ou motif…" filters={[
        { name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "PENDING_APPROVAL", label: "À valider" }, { value: "APPROVED", label: "Approuvées" }, { value: "REJECTED", label: "Refusées" }, { value: "ORDERED", label: "Commandées" }, { value: "CANCELLED", label: "Annulées" }] },
        { name: "auteur", label: "Auteur", options: [{ value: "moi", label: "Mes demandes" }] },
      ]}>
        {ctx.can("purchases.request.create") && <Button asChild><Link href="/app/purchases/demandes/nouveau"><Plus className="size-4" /> Nouvelle demande</Link></Button>}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<ClipboardList className="size-8" />} title="Aucune demande d'achat" description="Une demande d'achat formalise un besoin avant la commande ; elle peut nécessiter une validation." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead className="hidden md:table-cell">Motif</TableHead><TableHead className="hidden sm:table-cell">Demandeur</TableHead><TableHead className="hidden md:table-cell">Besoin</TableHead><TableHead className="text-right">Estimation</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/app/purchases/demandes/${r.id}`} className="text-sm font-medium hover:text-brand">{r.number}</Link></TableCell>
                  <TableCell className="hidden max-w-xs truncate text-sm md:table-cell">{r.reason ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{names.get(r.requesterId) || "—"}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDate(r.neededBy)}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(r.estimate), r.currency)}</TableCell>
                  <TableCell><Status value={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/purchases/demandes" searchParams={sp} />
    </>
  );
}
