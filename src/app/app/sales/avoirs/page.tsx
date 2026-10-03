import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
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
import { listCreditNotes } from "@/modules/sales/invoices";

export const metadata: Metadata = { title: "Avoirs" };

export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("finance.credit_note.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const { rows, total } = await listCreditNotes(ctx, { skip: lp.skip, take: lp.take });
  return (
    <>
      {rows.length === 0 ? <EmptyState icon={<ReceiptText className="size-8" />} title="Aucun avoir" description="Un avoir se crée depuis la fiche d'une facture émise (retour de marchandise, erreur de prix, geste commercial)." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Client</TableHead><TableHead className="hidden sm:table-cell">Facture</TableHead><TableHead className="hidden md:table-cell">Date</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/app/sales/avoirs/${c.id}`} className="text-sm font-medium hover:text-brand">{c.number ?? "Brouillon"}</Link></TableCell>
                  <TableCell className="text-sm">{c.invoice.customer.name}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell"><Link href={`/app/sales/factures/${c.invoice.id}`} className="hover:text-brand">{c.invoice.number}</Link></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDate(c.issueDate)}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(c.total), c.currency)}</TableCell>
                  <TableCell><Status value={c.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/sales/avoirs" searchParams={sp} />
    </>
  );
}
