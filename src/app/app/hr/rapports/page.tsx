import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { param, type SearchParams } from "@/lib/list-params";
import { monthlyReport } from "@/modules/hr/reports";
import { formatMinutes } from "@/modules/hr/time";
import { ExportLinks } from "@/modules/hr/ui/export-links";

export const metadata: Metadata = { title: "Rapports RH" };
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const n = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v));

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("hr.employee.read");
  const sp = await searchParams;
  const now = new Date();
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(param(sp, "mois") ?? "");
  const year = m ? Number(m[1]) : now.getUTCFullYear(), month = m ? Number(m[2]) : now.getUTCMonth() + 1;
  const prev = new Date(Date.UTC(year, month - 2, 1)), next = new Date(Date.UTC(year, month, 1));
  const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const rep = await monthlyReport(ctx, year, month);
  const t = rep.totals;
  const mois = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/app/hr/rapports?mois=${ym(prev)}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">← Mois précédent</Link>
        <p className="text-sm font-medium capitalize">{MONTHS[month - 1]} {year}</p>
        <Link href={`/app/hr/rapports?mois=${ym(next)}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Mois suivant →</Link>
        <span className="ml-auto flex gap-2"><ExportLinks kind="hr-rapport-mensuel" params={{ mois }} /></span>
      </div>
      <p className="text-xs text-muted-foreground">Rapport consolidé du mois, un salarié par ligne. Les colonnes affichées dépendent de vos droits sur chaque registre. Jours = jours ouvrés (calendrier de l&apos;entreprise) ; arrêts maladie = jours calendaires.</p>
      <Card className="overflow-x-auto p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead className="text-right">Congés (j)</TableHead><TableHead className="text-right">Permissions</TableHead><TableHead className="text-right">Absences (j)</TableHead><TableHead className="text-right">dont injustifiées</TableHead><TableHead className="text-right">Arrêts maladie (j)</TableHead><TableHead className="text-right">Retards</TableHead><TableHead className="text-right">H. supp. approuvées</TableHead><TableHead className="text-right">Accidents</TableHead></TableRow></TableHeader>
          <TableBody>
            {rep.rows.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">Aucun salarié sur ce mois.</TableCell></TableRow>}
            {rep.rows.map((r) => (
              <TableRow key={r.employeeId}>
                <TableCell className="text-sm font-medium"><Link href={`/app/hr/salaries/${r.employeeId}`} className="hover:text-brand">{r.name}</Link><span className="block text-xs font-normal text-muted-foreground">{r.number}{r.department ? ` · ${r.department}` : ""}</span></TableCell>
                <TableCell className="text-right text-sm tabular">{n(r.leaveDays)}</TableCell>
                <TableCell className="text-right text-sm tabular">{r.timeOffDays === null ? "—" : `${n(r.timeOffDays)} j${r.timeOffHours ? ` + ${n(r.timeOffHours)} h` : ""}`}</TableCell>
                <TableCell className="text-right text-sm tabular">{n(r.absenceDays)}</TableCell>
                <TableCell className="text-right text-sm tabular">{n(r.unjustifiedDays)}</TableCell>
                <TableCell className="text-right text-sm tabular">{n(r.sickDays)}</TableCell>
                <TableCell className="text-right text-sm tabular">{r.lateCount === null ? "—" : `${r.lateCount}${r.lateMinutes ? ` (${formatMinutes(r.lateMinutes)})` : ""}`}</TableCell>
                <TableCell className="text-right text-sm tabular">{n(r.overtimeHours)}</TableCell>
                <TableCell className="text-right text-sm tabular">{n(r.accidents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {rep.rows.length > 0 && (
            <TableFooter><TableRow>
              <TableCell className="text-sm font-semibold">Total</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{n(t.leaveDays)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{t.timeOffDays === null ? "—" : `${n(t.timeOffDays)} j${t.timeOffHours ? ` + ${n(t.timeOffHours)} h` : ""}`}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{n(t.absenceDays)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{n(t.unjustifiedDays)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{n(t.sickDays)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{t.lateCount === null ? "—" : `${t.lateCount}${t.lateMinutes ? ` (${formatMinutes(t.lateMinutes)})` : ""}`}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{n(t.overtimeHours)}</TableCell>
              <TableCell className="text-right text-sm font-semibold tabular">{n(t.accidents)}</TableCell>
            </TableRow></TableFooter>
          )}
        </Table>
      </Card>
    </div>
  );
}
