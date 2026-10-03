import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { forbidden } from "next/navigation";
import { PAGE_SIZE, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listPayslips, periodLabel } from "@/modules/payroll/service";

export const metadata: Metadata = { title: "Bulletins de paie" };

export default async function PayslipsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("payroll");
  if (!ctx.can("hr.payroll.manage") && !ctx.can("hr.payslip.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const manage = ctx.can("hr.payroll.manage");
  const { rows, total } = await listPayslips(ctx, { skip: lp.skip, take: lp.take });
  const cur = ctx.company.currency;
  return (
    <>
      {rows.length === 0 ? <EmptyState icon={<FileText className="size-8" />} title="Aucun bulletin" description={manage ? "Les bulletins apparaissent ici une fois la campagne validée." : "Vos bulletins apparaissent ici une fois la paie validée. Si vous n'en voyez pas, votre compte n'est peut-être pas lié à une fiche salarié."} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Période</TableHead>{manage && <TableHead>Salarié</TableHead>}<TableHead className="hidden sm:table-cell">N°</TableHead><TableHead className="text-right">Brut</TableHead><TableHead className="text-right">Net</TableHead><TableHead>Statut</TableHead><TableHead className="w-10"><span className="sr-only">PDF</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium capitalize">{periodLabel(p.run.year, p.run.month)}</TableCell>
                  {manage && <TableCell className="text-sm">{p.employee.lastName} {p.employee.firstName}</TableCell>}
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{p.number}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(p.gross), cur)}</TableCell>
                  <TableCell className="text-right text-sm font-medium tabular">{formatMoney(num(p.netPay), cur)}</TableCell>
                  <TableCell><Status value={p.run.status === "PAID" ? "PAID" : "VALIDATED"} /></TableCell>
                  <TableCell><a href={`/api/pdf/payslip/${p.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Bulletin ${p.number}`} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"><FileText className="size-4" /></a></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/payroll/bulletins" searchParams={sp} />
    </>
  );
}
