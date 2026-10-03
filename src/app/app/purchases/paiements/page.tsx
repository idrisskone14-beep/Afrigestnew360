import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listSupplierPayments } from "@/modules/purchasing/bills";

export const metadata: Metadata = { title: "Paiements fournisseurs" };
const METHOD: Record<string, string> = { CASH: "Espèces", BANK_TRANSFER: "Virement", CHEQUE: "Chèque", MOBILE_MONEY: "Mobile money", CARD: "Carte", OTHER: "Autre" };

export default async function SupplierPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("purchases.payment.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const { rows, total } = await listSupplierPayments(ctx, { q: lp.q, skip: lp.skip, take: lp.take });
  return (
    <>
      <ListToolbar placeholder="N°, référence ou fournisseur…" />
      {rows.length === 0 ? <EmptyState icon={<CircleDollarSign className="size-8" />} title="Aucun paiement fournisseur" description="Les règlements se saisissent depuis une facture fournisseur validée." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Fournisseur</TableHead><TableHead className="hidden sm:table-cell">Facture</TableHead><TableHead className="hidden md:table-cell">Date</TableHead><TableHead className="hidden md:table-cell">Mode</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">{p.number}<span className="block text-xs font-normal text-muted-foreground">{p.reference ?? ""}</span></TableCell>
                  <TableCell className="text-sm">{p.supplier?.name ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{p.bill ? <Link href={`/app/purchases/factures/${p.bill.id}`} className="hover:text-brand">{p.bill.number}</Link> : "—"}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDate(p.date)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{METHOD[p.method]}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(p.amount), p.currency)}</TableCell>
                  <TableCell><Status value={p.status === "VALIDATED" ? "PAID" : p.status === "PENDING" ? "PENDING_APPROVAL" : "CANCELLED"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/purchases/paiements" searchParams={sp} />
    </>
  );
}
