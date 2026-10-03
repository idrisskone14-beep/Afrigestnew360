import type { Metadata } from "next";
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, parseListParams, type SearchParams } from "@/lib/list-params";
import { listReceipts } from "@/modules/purchasing/procurement";

export const metadata: Metadata = { title: "Réceptions" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("purchases.receipt.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const { rows, total } = await listReceipts(ctx, { q: lp.q, skip: lp.skip, take: lp.take });
  return (
    <>
      <ListToolbar placeholder="N° ou fournisseur…" />
      {rows.length === 0 ? <EmptyState icon={<PackageCheck className="size-8" />} title="Aucune réception" description="Les bons de réception sont créés depuis une commande fournisseur validée." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Fournisseur</TableHead><TableHead className="hidden sm:table-cell">Commande</TableHead><TableHead className="hidden md:table-cell">Date</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/app/purchases/receptions/${r.id}`} className="text-sm font-medium hover:text-brand">{r.number}</Link></TableCell>
                  <TableCell className="text-sm">{r.supplier.name}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell"><Link href={`/app/purchases/commandes/${r.order.id}`} className="hover:text-brand">{r.order.number}</Link></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDate(r.receiptDate)}</TableCell>
                  <TableCell><Status value={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/purchases/receptions" searchParams={sp} />
    </>
  );
}
