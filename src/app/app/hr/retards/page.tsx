import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { AlarmClock, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListScope, SelectionBar } from "@/components/app/data-list";
import { KpiCards } from "@/components/app/kpi-cards";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { latenessStats, listLateness, recurringLateness } from "@/modules/hr/lateness";
import { loadPolicy, policyForm } from "@/modules/hr/policy";
import { deleteLatenessAction } from "@/modules/hr/registers-actions";
import { JUSTIFICATIONS } from "@/modules/hr/registers-schemas";
import { LATENESS_SCOPE, scopeOf } from "@/modules/hr/scope";
import { formatMinutes } from "@/modules/hr/time";
import { ExportLinks } from "@/modules/hr/ui/export-links";
import { ImportLatenessDialog, JustifyDialog, LatenessDialog, PolicyDialog } from "@/modules/hr/ui/register-dialogs";

export const metadata: Metadata = { title: "Retards" };
const label = (v: string) => JUSTIFICATIONS.find((x) => x.value === v)?.label ?? v;
const JUST_TONE = { PENDING: "warning", PROVIDED: "info", ACCEPTED: "success", REFUSED: "danger" } as const;
const dateOnly = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function LatenessPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  const scope = await scopeOf(ctx, LATENESS_SCOPE);
  if (scope.kind === "none") forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const justification = enumParam(sp, "justificatif", ["PENDING", "PROVIDED", "ACCEPTED", "REFUSED"] as const);
  const du = dateOnly(param(sp, "periode_du")), au = dateOnly(param(sp, "periode_au"));
  const now = new Date();
  const manage = ctx.can("hr.lateness.manage");
  const [{ rows, total }, stats, recurring, policy, employees] = await Promise.all([
    listLateness(ctx, { justification, from: du ? new Date(`${du}T00:00:00.000Z`) : undefined, to: au ? new Date(`${au}T00:00:00.000Z`) : undefined, q: lp.q || undefined, skip: lp.skip, take: lp.take }),
    latenessStats(ctx, now.getUTCFullYear(), now.getUTCMonth() + 1),
    recurringLateness(ctx),
    loadPolicy(ctx.db),
    manage ? ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);
  const opts = employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }));

  return (
    <ListScope filename="retards">
      <KpiCards items={[
        { label: "Retards ce mois", amount: String(stats.count), tone: "blue" },
        { label: "Minutes cumulées", amount: formatMinutes(stats.minutes), tone: "amber" },
        { label: "Non justifiés", amount: String(stats.unjustified), tone: stats.unjustified ? "red" : "green" },
        { label: "Salariés concernés", amount: String(stats.employees), tone: "blue" },
      ]} />
      {recurring.length > 0 && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardHeader><CardTitle className="text-base">Retards récurrents</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {recurring.map((r) => <p key={r.employeeId}><b>{r.name}</b> ({r.number}) : {r.count} retard(s) non justifié(s), {formatMinutes(r.minutes)} cumulées sur les {policy.lateRecurrenceDays} derniers jours.</p>)}
            <p className="pt-1 text-xs text-muted-foreground">Signal destiné à la RH. Un retard, même répété, ne déclenche automatiquement ni sanction ni retenue.</p>
          </CardContent>
        </Card>
      )}
      <ListToolbar placeholder="Salarié, matricule…" filters={[
        { name: "justificatif", label: "Justification", options: JUSTIFICATIONS.filter((j) => j.value !== "NOT_REQUIRED").map((j) => ({ value: j.value, label: j.label })) },
        { name: "periode", label: "Période", kind: "date" },
      ]}>
        <ExportLinks kind="hr-retards" params={{ q: lp.q || undefined, justificatif: justification, du, au }} />
        {ctx.can("hr.holiday.manage") && <PolicyDialog policy={policyForm(policy)} />}
        {manage && <ImportLatenessDialog />}
        {manage && opts.length > 0 && <LatenessDialog employees={opts} defaultExpected={policy.schedule.start} />}
      </ListToolbar>
      <SelectionBar />
      {rows.length === 0 ? <EmptyState icon={<AlarmClock className="size-8" />} title="Aucun retard" description={manage ? "Enregistrez un retard, ou importez-les depuis les présences (horaire de référence : " + policy.schedule.start + ")." : "Les retards enregistrés apparaissent ici."} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Salarié</TableHead><TableHead>Prévue</TableHead><TableHead>Arrivée</TableHead><TableHead className="text-right">Retard</TableHead><TableHead>Justification</TableHead><TableHead>Motif</TableHead><TableHead className="w-36"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.date)}{r.source === "ATTENDANCE" && <span className="block text-xs">via présences</span>}</TableCell>
                  <TableCell className="text-sm font-medium"><Link href={ctx.can("hr.employee.read") ? `/app/hr/salaries/${r.employee.id}` : "/app/hr/retards"} className="hover:text-brand">{r.employee.lastName} {r.employee.firstName}</Link><span className="block text-xs font-normal text-muted-foreground">{r.employee.number}</span></TableCell>
                  <TableCell className="text-sm tabular">{r.expectedTime}</TableCell>
                  <TableCell className="text-sm tabular">{r.actualTime}</TableCell>
                  <TableCell className="text-right text-sm font-medium tabular">{formatMinutes(r.minutesLate)}</TableCell>
                  <TableCell><StatusBadge tone={JUST_TONE[r.justification as keyof typeof JUST_TONE] ?? "neutral"}>{label(r.justification)}</StatusBadge>{r.hrNote && <span className="block text-xs text-muted-foreground">{r.hrNote}</span>}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm text-muted-foreground" title={r.reason ?? undefined}>{r.reason ?? "—"}</TableCell>
                  <TableCell>
                    {manage && (
                      <div className="flex items-center justify-end gap-1">
                        <JustifyDialog kind="lateness" id={r.id} current={r.justification} note={r.hrNote} />
                        <LatenessDialog employees={[]} defaultExpected={policy.schedule.start} lateness={{ id: r.id, expectedTime: r.expectedTime, actualTime: r.actualTime, reason: r.reason }} />
                        <ActionButton action={deleteLatenessAction} input={{ id: r.id }} size="sm" variant="ghost" label="" ariaLabel="Supprimer le retard" icon={<Trash2 className="size-4" />} success="Retard supprimé" confirm={{ title: "Supprimer ce retard ?", description: "La suppression est tracée dans le journal d'audit.", confirmLabel: "Supprimer" }} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/retards" searchParams={sp} />
    </ListScope>
  );
}
