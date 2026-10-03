import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ShoppingCart } from "lucide-react";
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
import { listOrders } from "@/modules/purchasing/procurement";

export const metadata: Metadata = { title: "Commandes fournisseur" };
const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "BILLED", "CANCELLED"] as const;

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("purchases.order.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const { rows, total } = await listOrders(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });
  return (
    <>
      <ListToolbar placeholder="N° ou fournisseur…" filters={[{ name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "PENDING_APPROVAL", label: "À valider" }, { value: "APPROVED", label: "À réceptionner" }, { value: "PARTIALLY_RECEIVED", label: "Reçues en partie" }, { value: "RECEIVED", label: "Reçues" }, { value: "BILLED", label: "Facturées" }, { value: "CANCELLED", label: "Annulées" }] }]}>
        {ctx.can("purchases.order.create") && <Button asChild><Link href="/app/purchases/commandes/nouveau"><Plus className="size-4" /> Nouvelle commande</Link></Button>}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<ShoppingCart className="size-8" />} title="Aucune commande fournisseur" description="Créez une commande ou transformez une demande d'achat approuvée." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Fournisseur</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead className="hidden md:table-cell">Attendue</TableHead><TableHead className="text-right">Total TTC</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell><Link href={`/app/purchases/commandes/${o.id}`} className="text-sm font-medium hover:text-brand">{o.number}</Link></TableCell>
                  <TableCell className="text-sm">{o.supplier.name}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(o.orderDate)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDate(o.expectedDate)}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(o.total), o.currency)}</TableCell>
                  <TableCell><Status value={o.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/purchases/commandes" searchParams={sp} />
    </>
  );
}
