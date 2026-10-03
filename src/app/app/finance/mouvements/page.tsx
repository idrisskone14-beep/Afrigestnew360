import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listAccounts, listTransactions } from "@/modules/finance/treasury";
import { TransactionActions } from "@/modules/finance/ui/transaction-actions";

export const metadata: Metadata = { title: "Mouvements" };
const TYPES = ["IN", "OUT", "TRANSFER_IN", "TRANSFER_OUT"] as const;
const TYPE_LABEL = { IN: "Entrée", OUT: "Sortie", TRANSFER_IN: "Transfert reçu", TRANSFER_OUT: "Transfert émis" } as const;
const SOURCE_HREF: Record<string, (id: string) => string | null> = { payment: () => "/app/sales/paiements", supplier_payment: () => "/app/purchases/paiements", expense: (id) => `/app/finance/depenses/${id}` };
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : undefined);

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("finance.account.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const accounts = await listAccounts(ctx, { includeInactive: true });
  const accountId = accounts.find((a) => a.id === param(sp, "compte"))?.id;
  const type = enumParam(sp, "type", TYPES);
  const from = isDate(param(sp, "du"));
  const toRaw = isDate(param(sp, "au"));
  const to = toRaw ? new Date(toRaw.getTime() + 86_399_999) : undefined;
  const { rows, total } = await listTransactions(ctx, { q: lp.q, accountId, type, from, to, skip: lp.skip, take: lp.take });
  const manage = ctx.can("finance.account.manage");
  const cur = ctx.company.currency;

  return (
    <>
      <ListToolbar placeholder="Libellé ou référence…" filters={[
        { name: "compte", label: "Compte", options: accounts.map((a) => ({ value: a.id, label: a.name })) },
        { name: "type", label: "Type", options: TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })) },
      ]} />
      {rows.length === 0 ? <EmptyState icon={<ArrowLeftRight className="size-8" />} title="Aucun mouvement" description="Les encaissements, paiements, dépenses et transferts apparaissent ici." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Libellé</TableHead><TableHead className="hidden md:table-cell">Compte</TableHead><TableHead className="hidden lg:table-cell">Catégorie</TableHead><TableHead className="text-right">Montant</TableHead><TableHead className="w-24"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((t) => {
                const inflow = t.type === "IN" || t.type === "TRANSFER_IN";
                const href = t.sourceType && t.sourceId ? SOURCE_HREF[t.sourceType]?.(t.sourceId) : null;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(t.date)}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-sm">
                      {href ? <Link href={href} className="hover:text-brand">{t.description}</Link> : t.description}
                      <span className="block text-xs text-muted-foreground">{TYPE_LABEL[t.type]}{t.reference ? ` · ${t.reference}` : ""}{t.reconciledAt ? " · rapproché" : ""}</span>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{t.account.name}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{t.category?.name ?? <StatusBadge>—</StatusBadge>}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right text-sm tabular ${inflow ? "text-success" : ""}`}>{inflow ? "+" : "−"} {formatMoney(num(t.amount), cur)}</TableCell>
                    <TableCell><TransactionActions id={t.id} reconciled={Boolean(t.reconciledAt)} canReconcile={manage} canCancel={manage && (t.sourceType === "manual" || t.sourceType === "transfer")} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/finance/mouvements" searchParams={sp} />
    </>
  );
}
