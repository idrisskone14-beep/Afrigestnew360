import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { AlertTriangle, HeartPulse } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListScope, SelectionBar } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { loadPolicy, policyForm } from "@/modules/hr/policy";
import { cancelSickLeaveAction } from "@/modules/hr/registers-actions";
import { CERTIFICATE_STATUSES, SICK_STATUSES } from "@/modules/hr/registers-schemas";
import { listSickLeaves, sickLeaveAlerts } from "@/modules/hr/sickleave";
import { ExportLinks } from "@/modules/hr/ui/export-links";
import { ExtendSickDialog, PolicyDialog, ReturnSickDialog, SickLeaveDialog } from "@/modules/hr/ui/register-dialogs";

export const metadata: Metadata = { title: "Arrêts maladie" };
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;
const STATUS_TONE = { ONGOING: "info", ENDED: "success", CANCELLED: "neutral" } as const;
const CERT_TONE = { PENDING: "warning", PROVIDED: "info", ACCEPTED: "success", REFUSED: "danger" } as const;

export default async function SickLeavesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.sickleave.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["ONGOING", "ENDED", "CANCELLED"] as const);
  const manage = ctx.can("hr.sickleave.manage");
  const [{ rows, total }, due, policy, employees] = await Promise.all([
    listSickLeaves(ctx, { status, q: lp.q || undefined, skip: lp.skip, take: lp.take }),
    sickLeaveAlerts(ctx),
    loadPolicy(ctx.db),
    manage ? ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <ListScope filename="arrets-maladie">
      {due.length > 0 && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-600" /> Reprises à suivre</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {due.map((r) => <p key={r.id}><Link href={`/app/hr/arrets-maladie/${r.id}`} className="font-medium hover:text-brand">{r.employee.lastName} {r.employee.firstName}</Link> ({r.employee.number}) : {r.alerts.filter((a) => a.code !== "certificate").map((a) => a.message).join(" ; ")}.</p>)}
          </CardContent>
        </Card>
      )}
      <ListToolbar placeholder="Salarié, matricule…" filters={[{ name: "statut", label: "Statut", options: SICK_STATUSES.map((s) => ({ value: s.value, label: s.label })) }]}>
        <ExportLinks kind="hr-arrets-maladie" params={{ q: lp.q || undefined, statut: status }} />
        {ctx.can("hr.holiday.manage") && <PolicyDialog policy={policyForm(policy)} />}
        {manage && employees.length > 0 && <SickLeaveDialog employees={employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }))} />}
      </ListToolbar>
      <SelectionBar />
      <p className="mb-3 text-xs text-muted-foreground">Suivi administratif uniquement : aucun diagnostic ni information médicale n&apos;est enregistré. Les certificats se joignent depuis la fiche, en accès restreint.</p>
      {rows.length === 0 ? <EmptyState icon={<HeartPulse className="size-8" />} title="Aucun arrêt maladie" description="Les arrêts enregistrés apparaissent ici, avec leurs prolongations et la reprise." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead>Période</TableHead><TableHead className="text-right">Jours</TableHead><TableHead>Justificatif</TableHead><TableHead>Statut</TableHead><TableHead>Alertes</TableHead><TableHead className="w-56"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium"><Link href={`/app/hr/arrets-maladie/${r.id}`} className="hover:text-brand">{r.employee.lastName} {r.employee.firstName}</Link><span className="block text-xs font-normal text-muted-foreground">{r.employee.number}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.startDate)} → {fmtDate(r.expectedEndDate)}{r.returnDate && <span className="block text-xs">reprise le {fmtDate(r.returnDate)}</span>}{r._count.extensions > 0 && <span className="block text-xs">{r._count.extensions} prolongation(s)</span>}</TableCell>
                  <TableCell className="text-right text-sm tabular">{r.days}</TableCell>
                  <TableCell><StatusBadge tone={CERT_TONE[r.certificate as keyof typeof CERT_TONE]}>{label(CERTIFICATE_STATUSES, r.certificate)}</StatusBadge></TableCell>
                  <TableCell><StatusBadge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE]}>{label(SICK_STATUSES, r.status)}</StatusBadge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.alerts.length ? r.alerts.map((a) => a.message).join(" · ") : "—"}</TableCell>
                  <TableCell>
                    {manage && r.status === "ONGOING" && (
                      <div className="flex items-center justify-end gap-1">
                        <ExtendSickDialog id={r.id} currentEnd={r.expectedEndDate} />
                        <ReturnSickDialog id={r.id} expectedEnd={r.expectedEndDate} />
                        <ActionButton action={cancelSickLeaveAction} input={{ id: r.id }} size="sm" variant="ghost" label="Annuler" success="Arrêt annulé" confirm={{ title: "Annuler cet arrêt ?", description: "Les jours redeviennent disponibles. L'annulation est tracée.", confirmLabel: "Annuler l'arrêt" }} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/arrets-maladie" searchParams={sp} />
    </ListScope>
  );
}
