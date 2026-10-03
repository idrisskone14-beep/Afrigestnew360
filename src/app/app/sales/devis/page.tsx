import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
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
import { effectiveQuoteStatus, listQuotes } from "@/modules/sales/quotes";

export const metadata: Metadata = { title: "Devis" };
const STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"] as const;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("sales.quote.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const { rows, total } = await listQuotes(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });

  return (
    <>
      <ListToolbar placeholder="N° ou client…" filters={[{ name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "SENT", label: "Envoyés" }, { value: "ACCEPTED", label: "Acceptés" }, { value: "REJECTED", label: "Refusés" }, { value: "EXPIRED", label: "Expirés" }, { value: "CONVERTED", label: "Convertis" }] }]}>
        {ctx.can("sales.quote.create") && <Button asChild><Link href="/app/sales/devis/nouveau"><Plus className="size-4" /> Nouveau devis</Link></Button>}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<FileText className="size-8" />} title="Aucun devis" description="Créez un devis, envoyez-le, puis transformez-le en commande ou en facture sans ressaisie." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Client</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead className="hidden md:table-cell">Validité</TableHead><TableHead className="text-right">Total TTC</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((q) => (
                <TableRow key={q.id}>
                  <TableCell><Link href={`/app/sales/devis/${q.id}`} className="text-sm font-medium hover:text-brand">{q.number}</Link>{q.kind === "PROFORMA" && <span className="ml-1.5 text-xs text-muted-foreground">proforma</span>}</TableCell>
                  <TableCell className="text-sm">{q.customer.name}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(q.issueDate)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDate(q.validUntil)}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(q.total), q.currency)}</TableCell>
                  <TableCell><Status value={effectiveQuoteStatus(q)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/sales/devis" searchParams={sp} />
    </>
  );
}
