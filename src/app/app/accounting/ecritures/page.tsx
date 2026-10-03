import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
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
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { defaultFiscalYear, journalListing } from "@/modules/accounting/reports";
import { listFiscalYears, listJournals } from "@/modules/accounting/service";
import { YearSwitch } from "@/modules/accounting/ui/year-switch";

export const metadata: Metadata = { title: "Écritures comptables" };
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : undefined);

export default async function EntriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("accounting.entry.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const [years, journals] = await Promise.all([listFiscalYears(ctx), listJournals(ctx)]);
  const fy = await defaultFiscalYear(ctx, years.find((y) => y.id === param(sp, "exercice"))?.id);
  if (!fy) return null;
  const journalId = journals.find((j) => j.id === param(sp, "journal"))?.id;
  const status = enumParam(sp, "statut", ["DRAFT", "POSTED"] as const);
  const { rows, total } = await journalListing(ctx, { fiscalYearId: fy.id, journalId, status, from: isDate(param(sp, "du")), to: isDate(param(sp, "au")), q: lp.q, skip: lp.skip, take: lp.take });
  const cur = ctx.company.currency;

  return (
    <>
      <YearSwitch years={years} current={fy.id} basePath="/app/accounting/ecritures" params={{ journal: journalId, statut: status, q: lp.q }} />
      <ListToolbar placeholder="N°, libellé ou pièce…" filters={[
        { name: "journal", label: "Journal", options: journals.map((j) => ({ value: j.id, label: `${j.code} — ${j.name}` })) },
        { name: "statut", label: "Statut", options: [{ value: "POSTED", label: "Validées" }, { value: "DRAFT", label: "Brouillons" }] },
      ]}>
        {ctx.can("accounting.entry.create") && <Button asChild><Link href="/app/accounting/ecritures/nouveau"><Plus className="size-4" /> Nouvelle écriture</Link></Button>}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<BookOpen className="size-8" />} title="Aucune écriture" description="Les écritures sont générées automatiquement par les ventes, achats, paiements et dépenses, ou saisies manuellement (opérations diverses)." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Date</TableHead><TableHead className="hidden sm:table-cell">Journal</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell><Link href={`/app/accounting/ecritures/${e.id}`} className="whitespace-nowrap text-sm font-medium hover:text-brand">{e.status === "DRAFT" ? "Brouillon" : e.number}</Link></TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(e.date)}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{e.journal.code}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal text-sm">{e.description}{e.reference && <span className="block text-xs text-muted-foreground">{e.reference}</span>}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(e.lines.reduce((a, l) => a + num(l.debit), 0), cur)}</TableCell>
                  <TableCell><Status value={e.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/accounting/ecritures" searchParams={sp} />
    </>
  );
}
