import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { formatMoney } from "@/lib/reference-data";
import { listItems, listRuns, periodLabel } from "@/modules/payroll/service";
import { NewRunDialog } from "@/modules/payroll/ui/run-dialogs";

export const metadata: Metadata = { title: "Paie" };

export default async function PayrollPage() {
  const ctx = await requireModulePage("payroll");
  if (!ctx.can("hr.payroll.manage")) redirect("/app/payroll/bulletins");
  const [runs, items] = await Promise.all([listRuns(ctx), listItems(ctx)]);
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  return (
    <>
      {items.length === 0 && (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">Aucune rubrique de paie n'est configurée : les bulletins ne comporteront que le salaire de base. Configurez vos cotisations et impôts dans l'onglet <Link href="/app/payroll/rubriques" className="font-medium underline">Rubriques</Link>.</p>
      )}
      <div className="mb-4 flex justify-end"><NewRunDialog defaultYear={prev.getUTCFullYear()} defaultMonth={prev.getUTCMonth() + 1} /></div>
      {runs.length === 0 ? <EmptyState icon={<Banknote className="size-8" />} title="Aucune campagne de paie" description="Préparez la paie du mois : les bulletins sont calculés pour tous les salariés." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Période</TableHead><TableHead className="hidden sm:table-cell">Bulletins</TableHead><TableHead className="text-right">Brut</TableHead><TableHead className="text-right">Net à payer</TableHead><TableHead className="hidden text-right md:table-cell">Coût employeur</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/app/payroll/campagnes/${r.id}`} className="text-sm font-medium capitalize hover:text-brand">{periodLabel(r.year, r.month)}</Link></TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{r._count.payslips}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(r.totalGross), r.currency)}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(num(r.totalNet), r.currency)}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular md:table-cell">{formatMoney(num(r.totalGross) + num(r.totalEmployer), r.currency)}</TableCell>
                  <TableCell><Status value={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
