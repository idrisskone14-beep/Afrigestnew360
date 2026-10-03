import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listPayments } from "@/modules/sales/payments";
import { PaymentRowActions } from "@/modules/sales/ui/payment-row-actions";

export const metadata: Metadata = { title: "Paiements" };
const METHOD: Record<string, string> = { CASH: "Espèces", BANK_TRANSFER: "Virement", CHEQUE: "Chèque", MOBILE_MONEY: "Mobile money", CARD: "Carte", OTHER: "Autre" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("finance.payment.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["PENDING", "VALIDATED", "CANCELLED"] as const);
  const { rows, total } = await listPayments(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });
  const canValidate = ctx.can("finance.payment.validate");
  const pending = status === undefined ? await ctx.db.payment.count({ where: { direction: "IN", status: "PENDING" } }) : 0;

  return (
    <>
      <ListToolbar placeholder="N° de reçu, référence ou client…" filters={[{ name: "statut", label: "Statut", options: [{ value: "PENDING", label: "En attente" }, { value: "VALIDATED", label: "Validés" }, { value: "CANCELLED", label: "Annulés" }] }]} />
      {pending > 0 && canValidate && <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">{pending} paiement{pending > 1 ? "s" : ""} en attente de validation.</p>}
      {rows.length === 0 ? <EmptyState icon={<Wallet className="size-8" />} title="Aucun paiement" description="Les encaissements s'enregistrent depuis la fiche d'une facture émise." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Reçu</TableHead><TableHead>Client</TableHead><TableHead className="hidden sm:table-cell">Facture</TableHead><TableHead className="hidden md:table-cell">Date</TableHead><TableHead className="hidden md:table-cell">Mode</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead><TableHead className="w-24"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">{p.number}<span className="block text-xs font-normal text-muted-foreground">{p.reference ?? ""}</span></TableCell>
                  <TableCell className="text-sm">{p.customer?.name ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{p.invoice ? <Link href={`/app/sales/factures/${p.invoice.id}`} className="hover:text-brand">{p.invoice.number}</Link> : "—"}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDate(p.date)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{METHOD[p.method]}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(p.amount), p.currency)}</TableCell>
                  <TableCell><Status value={p.status === "VALIDATED" ? "PAID" : p.status === "CANCELLED" ? "CANCELLED" : "PENDING_APPROVAL"} /></TableCell>
                  <TableCell><PaymentRowActions id={p.id} status={p.status} canValidate={canValidate} canCancel={ctx.can("finance.payment.create") && (p.status === "PENDING" || canValidate)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/sales/paiements" searchParams={sp} />
    </>
  );
}
