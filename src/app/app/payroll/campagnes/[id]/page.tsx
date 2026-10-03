import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Ban, CheckCircle2, FileText, RefreshCw, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { cancelRunAction, recalculateRunAction, validateRunAction } from "@/modules/payroll/actions";
import { getRun, periodLabel } from "@/modules/payroll/service";
import { PayRunDialog } from "@/modules/payroll/ui/run-dialogs";
import { DocHeader } from "@/modules/sales/ui/doc-kit";
import { listAccounts } from "@/modules/finance/treasury";

export const metadata: Metadata = { title: "Campagne de paie" };

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("hr.payroll.manage");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const run = await getRun(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const cur = run.currency;
  const financeOn = ctx.hasModule("finance") && ctx.can("finance.account.read");
  const accounts = run.status === "VALIDATED" && financeOn ? await listAccounts(ctx) : [];
  const label = periodLabel(run.year, run.month);
  const account = run.accountId && financeOn ? await ctx.db.financeAccount.findFirst({ where: { id: run.accountId }, select: { name: true } }) : null;

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Paie", href: "/app/payroll" }, { label }]}
        title={`Paie — ${label}`}
        badges={<Status value={run.status} />}
        subtitle={<>{run.calculatedAt ? `Calculée le ${fmtDate(run.calculatedAt)}` : ""}{run.validatedAt ? ` · validée le ${fmtDate(run.validatedAt)}` : ""}{run.paidAt ? ` · payée le ${fmtDate(run.paidAt)}${account ? ` depuis ${account.name}` : ""}` : ""}</>}
      />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {run.status === "DRAFT" && <ActionButton action={recalculateRunAction} input={{ id }} variant="outline" label="Recalculer" icon={<RefreshCw className="size-4" />} success="Bulletins recalculés" />}
          {run.status === "DRAFT" && run.payslips.length > 0 && <ActionButton action={validateRunAction} input={{ id }} variant="default" label="Valider la paie" icon={<CheckCircle2 className="size-4" />} success="Paie validée" confirm={{ title: `Valider la paie de ${label} ?`, description: "Les bulletins sont numérotés et figés, et l'écriture comptable de paie est générée. Tant que les salaires ne sont pas payés, la campagne peut encore être annulée.", confirmLabel: "Valider" }} />}
          {run.status === "VALIDATED" && <PayRunDialog runId={id} net={num(run.totalNet)} currency={cur} financeOn={financeOn} accounts={accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance.toNumber(), type: a.type }))} />}
          {run.status === "DRAFT" && <ActionButton action={cancelRunAction} input={{ id }} variant="destructive" label="Supprimer le brouillon" icon={<Trash2 className="size-4" />} redirectTo="/app/payroll" success="Brouillon supprimé" confirm={{ title: "Supprimer ce brouillon ?" }} />}
          {run.status === "VALIDATED" && <ActionButton action={cancelRunAction} input={{ id }} variant="outline" label="Annuler la campagne" icon={<Ban className="size-4" />} success="Campagne annulée" confirm={{ title: "Annuler cette campagne ?", description: "L'écriture comptable de paie est contre-passée. Une campagne payée ne peut plus être annulée.", confirmLabel: "Annuler la campagne" }} />}
          {run.status === "PAID" && <p className="text-sm text-muted-foreground">Salaires payés : la campagne est clôturée.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Salaires bruts" value={formatMoney(num(run.totalGross), cur)} />
        <Kpi label="Retenues salariales" value={formatMoney(num(run.totalDeductions), cur)} />
        <Kpi label="Net à payer" value={formatMoney(num(run.totalNet), cur)} strong />
        <Kpi label="Coût employeur" value={formatMoney(num(run.totalGross) + num(run.totalEmployer), cur)} hint={`dont charges patronales ${formatMoney(num(run.totalEmployer), cur)}`} />
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead className="hidden sm:table-cell">N°</TableHead><TableHead className="hidden md:table-cell text-right">Temps payé</TableHead><TableHead className="text-right">Brut</TableHead><TableHead className="hidden text-right sm:table-cell">Retenues</TableHead><TableHead className="text-right">Net</TableHead><TableHead className="w-10"><span className="sr-only">Bulletin</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {run.payslips.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Aucun bulletin : aucun salarié avec un salaire de base ou des éléments de paie sur ce mois.</TableCell></TableRow>}
            {run.payslips.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-sm font-medium"><Link href={`/app/hr/salaries/${p.employee.id}`} className="hover:text-brand">{p.employee.lastName} {p.employee.firstName}</Link></TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{p.number ?? "—"}</TableCell>
                <TableCell className="hidden text-right text-sm tabular md:table-cell">{Math.round(num(p.prorata) * 100)} %{num(p.unpaidDays) > 0 ? ` (${num(p.unpaidDays)} j non payés)` : ""}</TableCell>
                <TableCell className="text-right text-sm tabular">{formatMoney(num(p.gross), cur)}</TableCell>
                <TableCell className="hidden text-right text-sm tabular sm:table-cell">{formatMoney(num(p.totalDeductions), cur)}</TableCell>
                <TableCell className="text-right text-sm font-medium tabular">{formatMoney(num(p.netPay), cur)}</TableCell>
                <TableCell><a href={`/api/pdf/payslip/${p.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Bulletin de ${p.employee.lastName} ${p.employee.firstName}`} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"><FileText className="size-4" /></a></TableCell>
              </TableRow>
            ))}
          </TableBody>
          {run.payslips.length > 0 && <TableFooter><TableRow><TableCell colSpan={3} className="hidden md:table-cell" /><TableCell className="text-right text-sm font-semibold tabular">{formatMoney(num(run.totalGross), cur)}</TableCell><TableCell className="hidden text-right text-sm font-semibold tabular sm:table-cell">{formatMoney(num(run.totalDeductions), cur)}</TableCell><TableCell className="text-right text-sm font-semibold tabular">{formatMoney(num(run.totalNet), cur)}</TableCell><TableCell /></TableRow></TableFooter>}
        </Table>
      </Card>
      {run.notes && <p className="text-sm text-muted-foreground">{run.notes}</p>}
    </div>
  );
}

function Kpi({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return <Card><CardContent className="space-y-1 p-5"><p className="text-sm text-muted-foreground">{label}</p><p className={`truncate text-xl font-semibold tracking-tight tabular ${strong ? "text-brand" : ""}`}>{value}</p>{hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}</CardContent></Card>;
}
