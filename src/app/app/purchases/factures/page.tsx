import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
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
import { billBalance, isBillOverdue, listBills } from "@/modules/purchasing/bills";

export const metadata: Metadata = { title: "Factures fournisseur" };
const STATUSES = ["DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "CANCELLED", "OVERDUE"] as const;

export default async function BillsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("purchases.bill.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const { rows, total } = await listBills(ctx, { q: lp.q, status: status === "OVERDUE" ? undefined : status, overdue: status === "OVERDUE", skip: lp.skip, take: lp.take });
  return (
    <>
      <ListToolbar placeholder="N°, n° fournisseur ou fournisseur…" filters={[{ name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "POSTED", label: "À payer" }, { value: "PARTIALLY_PAID", label: "Payées en partie" }, { value: "OVERDUE", label: "Échues" }, { value: "PAID", label: "Payées" }, { value: "CANCELLED", label: "Annulées" }] }]}>
        {ctx.can("purchases.bill.create") && <Button asChild><Link href="/app/purchases/factures/nouveau"><Plus className="size-4" /> Saisir une facture</Link></Button>}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Receipt className="size-8" />} title="Aucune facture fournisseur" description="Saisissez une facture reçue ou générez-la depuis une commande réceptionnée." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Fournisseur</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead className="hidden md:table-cell">Échéance</TableHead><TableHead className="text-right">Total TTC</TableHead><TableHead className="hidden text-right lg:table-cell">Reste</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((b) => {
                const overdue = isBillOverdue(b);
                return (
                  <TableRow key={b.id}>
                    <TableCell><Link href={`/app/purchases/factures/${b.id}`} className="text-sm font-medium hover:text-brand">{b.number ?? "Brouillon"}</Link>{b.supplierRef && <span className="block text-xs text-muted-foreground">{b.supplierRef}</span>}</TableCell>
                    <TableCell className="text-sm">{b.supplier.name}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(b.billDate)}</TableCell>
                    <TableCell className={`hidden text-sm md:table-cell ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{fmtDate(b.dueDate)}</TableCell>
                    <TableCell className="text-right text-sm tabular">{formatMoney(num(b.total), b.currency)}</TableCell>
                    <TableCell className="hidden text-right text-sm tabular lg:table-cell">{b.status === "DRAFT" || b.status === "CANCELLED" ? "—" : formatMoney(billBalance(b).toNumber(), b.currency)}</TableCell>
                    <TableCell><Status value={overdue ? "OVERDUE" : b.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/purchases/factures" searchParams={sp} />
    </>
  );
}
