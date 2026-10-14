import type { Metadata } from "next";
import Link from "next/link";
import { KpiCards, type Kpi } from "@/components/app/kpi-cards";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { param, type SearchParams } from "@/lib/list-params";
import { leaveOverview } from "@/modules/hr/analytics";
import { seesAllLeaves } from "@/modules/hr/leave";
import { LeaveCalendar } from "@/modules/hr/ui/leave-calendar";
import { LeaveFilters } from "@/modules/hr/ui/leave-filters";

export const metadata: Metadata = { title: "Suivi des congés" };

const nb = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);

export default async function LeaveTrackingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("hr.leave.read");
  if (!seesAllLeaves(ctx)) return <p className="text-sm text-muted-foreground">Le suivi de l&apos;ensemble des congés est réservé aux ressources humaines et aux valideurs. Vos propres soldes figurent dans l&apos;onglet Congés.</p>;

  const sp = await searchParams;
  const now = new Date();
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(param(sp, "mois") ?? "");
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const month = m ? Number(m[2]) : now.getUTCMonth() + 1;
  const uuid = /^[0-9a-f-]{36}$/;
  const departmentId = uuid.test(param(sp, "service") ?? "") ? param(sp, "service")! : "";
  const typeId = uuid.test(param(sp, "type") ?? "") ? param(sp, "type")! : "";
  const data = await leaveOverview(ctx, { year, month, departmentId: departmentId || undefined, typeId: typeId || undefined });

  const kpis: Kpi[] = [
    { label: "En congé aujourd'hui", amount: `${data.kpis.onLeaveToday} salarié${data.kpis.onLeaveToday > 1 ? "s" : ""}`, tone: "blue" },
    { label: "Départs en congé (30 jours)", amount: `${data.kpis.upcoming30} congé${data.kpis.upcoming30 > 1 ? "s" : ""}`, tone: "green" },
    { label: "Demandes à valider", count: data.kpis.pendingCount, amount: `${nb(data.kpis.pendingDays)} j`, tone: data.kpis.pendingCount > 0 ? "amber" : "blue" },
    { label: `Jours de congé pris en ${year}`, amount: `${nb(data.kpis.daysTakenYear)} j`, tag: data.kpis.usagePct === null ? undefined : `${nb(data.kpis.usagePct)} % du droit`, tone: "red" },
  ];
  const threshold = Math.max(2, Math.ceil(data.rows.length * 0.25)); // un quart de l'équipe absente : à surveiller
  const peakDates = data.peak.dates.map((d) => fmtDate(new Date(`${d}T00:00:00Z`))).slice(0, 3).join(", ");

  return (
    <div className="space-y-6">
      <KpiCards items={kpis} />
      <LeaveFilters year={year} month={month} departmentId={departmentId} typeId={data.balanceType?.id ?? ""} departments={data.departments} types={data.types.filter((t) => t.capped)} />

      <section aria-labelledby="cal-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="cal-title" className="text-lg font-semibold">Calendrier des absences</h2>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Légende">
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-brand-blue" aria-hidden="true" />Congé payé approuvé</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-brand-2" aria-hidden="true" />Congé sans solde approuvé</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-brand-blue bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,color-mix(in_srgb,var(--brand-blue)_40%,transparent)_2px,color-mix(in_srgb,var(--brand-blue)_40%,transparent)_4px)]" aria-hidden="true" />En attente</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-warning/30" aria-hidden="true" />Jour férié</li>
          </ul>
        </div>
        {data.peak.max >= 2 && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">Pic d&apos;absence du mois : <strong>{data.peak.max} salariés</strong> absents en même temps ({peakDates}){data.peak.max >= threshold ? " — à surveiller : une part importante de l'équipe est absente." : "."}</p>}
        <LeaveCalendar data={data} highThreshold={threshold} />
      </section>

      {data.pending.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-base">Demandes en attente de validation ({data.pending.length})</CardTitle><Link href="/app/validations" className="text-sm text-brand hover:underline">Ouvrir les validations</Link></CardHeader>
          <CardContent className="divide-y p-0">
            {data.pending.slice(0, 8).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm">
                <Link href={`/app/hr/salaries/${r.employeeId}?onglet=conges`} className="min-w-0 flex-1 font-medium hover:text-brand">{r.name}</Link>
                <span className="text-muted-foreground">{r.type}</span>
                <span className="tabular text-muted-foreground">{fmtDate(new Date(`${r.startDate}T00:00:00Z`))} → {fmtDate(new Date(`${r.endDate}T00:00:00Z`))}</span>
                <StatusBadge tone="warning">{nb(r.days)} j</StatusBadge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.balanceType && (
        <section aria-labelledby="bal-title" className="space-y-3">
          <div>
            <h2 id="bal-title" className="text-lg font-semibold">Soldes {year} — {data.balanceType.name}</h2>
            <p className="text-sm text-muted-foreground">Triés du plus bas au plus haut solde disponible. {data.balanceType.accrual === "MONTHLY" ? "Acquisition progressive : le disponible est le constitué à ce jour, moins le pris et l'en attente." : "Droit acquis dès le 1er janvier, proratisé l'année d'arrivée ou de départ."}</p>
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead className="hidden md:table-cell">Service</TableHead><TableHead className="text-right">Droit</TableHead><TableHead className="hidden text-right sm:table-cell">Report</TableHead><TableHead className="text-right">Pris</TableHead><TableHead className="hidden text-right sm:table-cell">En attente</TableHead><TableHead className="text-right">Reste</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.balances.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-sm font-medium"><Link href={`/app/hr/salaries/${b.id}?onglet=conges`} className="hover:text-brand">{b.name}</Link></TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{b.department ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular">{nb(b.entitlement)}</TableCell>
                    <TableCell className="hidden text-right text-sm tabular sm:table-cell">{b.carryOver > 0 ? <>{nb(b.carryOver)}{b.carryExpiresOn && <span className="block text-[11px] text-muted-foreground">avant le {fmtDate(new Date(`${b.carryExpiresOn}T00:00:00Z`))}</span>}</> : "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular">{nb(b.taken)}</TableCell>
                    <TableCell className="hidden text-right text-sm tabular sm:table-cell">{b.pending > 0 ? nb(b.pending) : "—"}</TableCell>
                    <TableCell className={`text-right text-sm font-semibold tabular ${b.remaining < 0 ? "text-destructive" : b.remaining <= 2 ? "text-warning" : ""}`}>{nb(b.remaining)}</TableCell>
                  </TableRow>
                ))}
                {data.balances.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Aucun salarié à afficher.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </div>
  );
}
