import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { ExportButton, ListScope, RowBox, SelectAllBox, SelectionBar } from "@/components/app/data-list";
import { KpiCards } from "@/components/app/kpi-cards";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { periodFor } from "@/core/tenant/period";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, dateRangeParam, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { invoiceBalance, isOverdue, listInvoices } from "@/modules/sales/invoices";
import { SentCell } from "@/modules/sales/ui/dispatch-history";
import { invoiceKpis } from "@/modules/sales/kpis";

export const metadata: Metadata = { title: "Factures" };
const STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED", "OVERDUE"] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("finance.invoice.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const period = await periodFor(sp, "emission");
  const due = dateRangeParam(sp, "echeance");
  const status = enumParam(sp, "statut", STATUSES);
  const { rows, total } = await listInvoices(ctx, { q: lp.q, status, period, due, skip: lp.skip, take: lp.take });
  const kpis = await invoiceKpis(ctx, period);
  return (
    <ListScope filename="factures">
      <KpiCards items={kpis} />
      <ListToolbar placeholder="N° ou client…" filters={[{ name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "ISSUED", label: "Émises" }, { value: "PARTIALLY_PAID", label: "Payées en partie" }, { value: "OVERDUE", label: "Échues" }, { value: "PAID", label: "Payées" }, { value: "CANCELLED", label: "Annulées" }] }, { name: "emission", label: "Émission", kind: "date" as const }, { name: "echeance", label: "Échéance", kind: "date" as const }]}>
        <ExportButton />
        {ctx.can("finance.invoice.create") && <Button asChild><Link href="/app/sales/factures/nouveau"><Plus className="size-4" /> Nouvelle facture</Link></Button>}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Receipt className="size-8" />} title="Aucune facture" description="Facturez une commande, convertissez un devis ou saisissez une facture." /> : (
        <>
        <SelectionBar />
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-10"><SelectAllBox /></TableHead><TableHead>N°</TableHead><TableHead>Client</TableHead><TableHead className="hidden sm:table-cell">Émission</TableHead><TableHead className="hidden md:table-cell">Échéance</TableHead><TableHead className="text-right">Total TTC</TableHead><TableHead className="hidden text-right lg:table-cell">Reste</TableHead><TableHead className="hidden md:table-cell">Envoi</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((i) => {
                const overdue = isOverdue(i);
                const bal = invoiceBalance(i).toNumber();
                return (
                  <TableRow key={i.id}>
                  <TableCell><RowBox id={i.id} label={i.number ?? "brouillon"} /></TableCell>
                    <TableCell><Link href={`/app/sales/factures/${i.id}`} className="text-sm font-medium hover:text-brand">{i.number ?? "Brouillon"}</Link></TableCell>
                    <TableCell className="text-sm">{i.customer.name}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(i.issueDate)}</TableCell>
                    <TableCell className={`hidden text-sm md:table-cell ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{fmtDate(i.dueDate)}</TableCell>
                    <TableCell className="text-right text-sm tabular">{formatMoney(num(i.total), i.currency)}</TableCell>
                    <TableCell className="hidden text-right text-sm tabular lg:table-cell">{i.status === "DRAFT" || i.status === "CANCELLED" ? "—" : formatMoney(bal, i.currency)}</TableCell>
                    <TableCell className="hidden md:table-cell"><SentCell at={i.sentAt} applicable={i.status !== "DRAFT" && i.status !== "CANCELLED"} /></TableCell>
                    <TableCell><Status value={overdue ? "OVERDUE" : i.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
        </>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/sales/factures" searchParams={sp} />
    </ListScope>
  );
}
