import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { defaultFiscalYear, trialBalance } from "@/modules/accounting/reports";
import { listFiscalYears } from "@/modules/accounting/service";
import { YearSwitch } from "@/modules/accounting/ui/year-switch";

export const metadata: Metadata = { title: "Balance générale" };
const CLASS_LABEL: Record<number, string> = { 1: "Ressources durables", 2: "Actif immobilisé", 3: "Stocks", 4: "Tiers", 5: "Trésorerie", 6: "Charges", 7: "Produits", 8: "Hors activités ordinaires" };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("accounting.ledger.read");
  const sp = await searchParams;
  const years = await listFiscalYears(ctx);
  const fy = await defaultFiscalYear(ctx, years.find((y) => y.id === param(sp, "exercice"))?.id);
  if (!fy) return null;
  const tb = await trialBalance(ctx, { fiscalYearId: fy.id });
  const cur = ctx.company.currency;
  const f = (n: number) => (n ? formatMoney(n, cur) : "");

  return (
    <>
      <YearSwitch years={years} current={fy.id} basePath="/app/accounting/balance" />
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Compte</TableHead><TableHead className="text-right">Total débit</TableHead><TableHead className="text-right">Total crédit</TableHead><TableHead className="text-right">Solde débiteur</TableHead><TableHead className="text-right">Solde créditeur</TableHead></TableRow></TableHeader>
          <TableBody>
            {tb.rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Aucune écriture validée sur cet exercice.</TableCell></TableRow>}
            {tb.rows.map((r, i) => (
              <Fragment key={r.id}>
                {(i === 0 || tb.rows[i - 1]!.class !== r.class) && <TableRow key={`c${r.class}`} className="bg-muted/40"><TableCell colSpan={5} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Classe {r.class} — {CLASS_LABEL[r.class]}</TableCell></TableRow>}
                <TableRow>
                  <TableCell className="text-sm"><Link href={`/app/accounting/grand-livre?compte=${r.id}&exercice=${fy.id}`} className="hover:text-brand"><span className="font-medium">{r.code}</span> <span className="text-muted-foreground">{r.name}</span></Link></TableCell>
                  <TableCell className="text-right text-sm tabular">{f(r.debit.toNumber())}</TableCell>
                  <TableCell className="text-right text-sm tabular">{f(r.credit.toNumber())}</TableCell>
                  <TableCell className="text-right text-sm tabular">{f(r.balance.gt(0) ? r.balance.toNumber() : 0)}</TableCell>
                  <TableCell className="text-right text-sm tabular">{f(r.balance.lt(0) ? r.balance.neg().toNumber() : 0)}</TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="text-sm font-semibold">Totaux {tb.balanced ? "· équilibrée" : "· DÉSÉQUILIBRÉE"}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{formatMoney(tb.totalDebit.toNumber(), cur)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{formatMoney(tb.totalCredit.toNumber(), cur)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{formatMoney(tb.rows.reduce((a, r) => a + (r.balance.gt(0) ? r.balance.toNumber() : 0), 0), cur)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{formatMoney(tb.rows.reduce((a, r) => a + (r.balance.lt(0) ? -r.balance.toNumber() : 0), 0), cur)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </>
  );
}
