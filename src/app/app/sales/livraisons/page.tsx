import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, parseListParams, type SearchParams } from "@/lib/list-params";
import { listDeliveries } from "@/modules/sales/orders";

export const metadata: Metadata = { title: "Bons de livraison" };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("sales.delivery.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const { rows, total } = await listDeliveries(ctx, { q: lp.q, skip: lp.skip, take: lp.take });
  return (
    <>
      <ListToolbar placeholder="N° ou client…" />
      {rows.length === 0 ? <EmptyState icon={<Truck className="size-8" />} title="Aucune livraison" description="Créez un bon de livraison depuis une commande confirmée." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Client</TableHead><TableHead className="hidden sm:table-cell">Commande</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((dl) => (
                <TableRow key={dl.id}>
                  <TableCell><Link href={`/app/sales/livraisons/${dl.id}`} className="text-sm font-medium hover:text-brand">{dl.number}</Link></TableCell>
                  <TableCell className="text-sm">{dl.customer.name}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell"><Link href={`/app/sales/commandes/${dl.order.id}`} className="hover:text-brand">{dl.order.number}</Link></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(dl.deliveryDate)}</TableCell>
                  <TableCell><Status value={dl.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/sales/livraisons" searchParams={sp} />
    </>
  );
}
