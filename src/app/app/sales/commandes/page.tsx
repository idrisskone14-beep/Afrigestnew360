import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ShoppingBag } from "lucide-react";
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
import { listOrders } from "@/modules/sales/orders";

export const metadata: Metadata = { title: "Commandes clients" };
const STATUSES = ["DRAFT", "CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "INVOICED", "CANCELLED"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("sales.order.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const { rows, total } = await listOrders(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });
  return (
    <>
      <ListToolbar placeholder="N° ou client…" filters={[{ name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "CONFIRMED", label: "Confirmées" }, { value: "PARTIALLY_DELIVERED", label: "Livrées en partie" }, { value: "DELIVERED", label: "Livrées" }, { value: "INVOICED", label: "Facturées" }, { value: "CANCELLED", label: "Annulées" }] }]}>
        {ctx.can("sales.order.create") && <Button asChild><Link href="/app/sales/commandes/nouveau"><Plus className="size-4" /> Nouvelle commande</Link></Button>}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<ShoppingBag className="size-8" />} title="Aucune commande" description="Les commandes naissent d'un devis accepté ou se saisissent directement." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Client</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead className="text-right">Total TTC</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell><Link href={`/app/sales/commandes/${o.id}`} className="text-sm font-medium hover:text-brand">{o.number}</Link></TableCell>
                  <TableCell className="text-sm">{o.customer.name}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(o.orderDate)}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(o.total), o.currency)}</TableCell>
                  <TableCell><Status value={o.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/sales/commandes" searchParams={sp} />
    </>
  );
}
