import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { param, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { defaultFiscalYear, generalLedger } from "@/modules/accounting/reports";
import { listFiscalYears, listLedgerAccounts } from "@/modules/accounting/service";
import { LedgerFilters } from "@/modules/accounting/ui/ledger-filters";
import { YearSwitch } from "@/modules/accounting/ui/year-switch";
import { BookOpen } from "lucide-react";

export const metadata: Metadata = { title: "Grand livre" };
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : undefined);

export default async function LedgerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("accounting.ledger.read");
  const sp = await searchParams;
  const [years, accounts] = await Promise.all([listFiscalYears(ctx), listLedgerAccounts(ctx, { includeInactive: true })]);
  const fy = await defaultFiscalYear(ctx, years.find((y) => y.id === param(sp, "exercice"))?.id);
  if (!fy) return null;
  const account = accounts.find((a) => a.id === param(sp, "compte"));
  const from = isDate(param(sp, "du"));
  const to = isDate(param(sp, "au"));
  const gl = account ? await generalLedger(ctx, { accountId: account.id, fiscalYearId: fy.id, from, to }) : null;
  const cur = ctx.company.currency;
  const totalDebit = gl?.rows.reduce((a, r) => a + r.debit.toNumber(), 0) ?? 0;
  const totalCredit = gl?.rows.reduce((a, r) => a + r.credit.toNumber(), 0) ?? 0;

  return (
    <>
      <YearSwitch years={years} current={fy.id} basePath="/app/accounting/grand-livre" params={{ compte: account?.id, du: param(sp, "du"), au: param(sp, "au") }} />
      <LedgerFilters accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }))} />
      {!gl ? <EmptyState icon={<BookOpen className="size-8" />} title="Choisissez un compte" description="Le grand livre liste tous les mouvements d'un compte avec son solde progressif." /> : (
        <Card className="overflow-hidden p-0">
          <div className="border-b px-4 py-3"><p className="text-sm font-semibold">{gl.account.code} — {gl.account.name}</p>{gl.truncated && <p className="text-xs text-warning">Affichage limité aux 5 000 premières lignes : réduisez la période.</p>}</div>
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Écriture</TableHead><TableHead className="hidden md:table-cell">Libellé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Solde</TableHead></TableRow></TableHeader>
            <TableBody>
              {from && <TableRow><TableCell colSpan={5} className="text-sm italic text-muted-foreground">Report au {fmtDate(from)}</TableCell><TableCell className="text-right text-sm tabular">{formatMoney(gl.openingBalance.toNumber(), cur)}</TableCell></TableRow>}
              {gl.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.entry.date)}</TableCell>
                  <TableCell className="text-sm"><Link href={`/app/accounting/ecritures/${r.entry.id}`} className="font-medium hover:text-brand">{r.entry.number}</Link><span className="ml-2 text-xs text-muted-foreground">{r.entry.journal.code}</span></TableCell>
                  <TableCell className="hidden max-w-xs whitespace-normal text-sm text-muted-foreground md:table-cell">{r.label}</TableCell>
                  <TableCell className="text-right text-sm tabular">{r.debit.gt(0) ? formatMoney(r.debit.toNumber(), cur) : ""}</TableCell>
                  <TableCell className="text-right text-sm tabular">{r.credit.gt(0) ? formatMoney(r.credit.toNumber(), cur) : ""}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(r.running.toNumber(), cur)}</TableCell>
                </TableRow>
              ))}
              {gl.rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Aucun mouvement sur la période.</TableCell></TableRow>}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={3} className="text-sm font-semibold">Totaux et solde final</TableCell><TableCell className="text-right text-sm font-semibold tabular">{formatMoney(totalDebit, cur)}</TableCell><TableCell className="text-right text-sm font-semibold tabular">{formatMoney(totalCredit, cur)}</TableCell><TableCell className="text-right text-sm font-semibold tabular">{formatMoney(gl.closingBalance.toNumber(), cur)}</TableCell></TableRow></TableFooter>
          </Table>
        </Card>
      )}
    </>
  );
}
