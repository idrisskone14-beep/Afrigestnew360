import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { AlertTriangle, Stethoscope } from "lucide-react";
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
import { VISIT_KINDS, VISIT_STATUSES } from "@/modules/hr/admin-schemas";
import { listVisits, visitAlerts } from "@/modules/hr/medvisits";
import { loadPolicy, policyForm } from "@/modules/hr/policy";
import { cancelVisitAction } from "@/modules/hr/registers-actions";
import { CompleteVisitDialog, VisitDialog } from "@/modules/hr/ui/admin-dialogs";
import { PolicyDialog } from "@/modules/hr/ui/register-dialogs";
import { ExportLinks } from "@/modules/hr/ui/export-links";

export const metadata: Metadata = { title: "Visites médicales" };
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;
const TONE = { PLANNED: "info", DONE: "success", CANCELLED: "neutral" } as const;

export default async function VisitsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.medvisit.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["PLANNED", "DONE", "CANCELLED"] as const);
  const kind = enumParam(sp, "type", ["HIRING", "PERIODIC", "RETURN", "OTHER"] as const);
  const manage = ctx.can("hr.medvisit.manage");
  const [{ rows, total }, alerts, policy, employees] = await Promise.all([
    listVisits(ctx, { status, kind, q: lp.q || undefined, skip: lp.skip, take: lp.take }),
    visitAlerts(ctx),
    loadPolicy(ctx.db),
    manage ? ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);
  const opts = employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }));
  const name = (e: { firstName: string; lastName: string; number: string }) => `${e.lastName} ${e.firstName} (${e.number})`;

  return (
    <ListScope filename="visites-medicales">
      {(alerts.overdue.length > 0 || alerts.soon.length > 0 || alerts.toSchedule.length > 0) && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-600" /> Rappels</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {alerts.overdue.map((v) => <p key={v.id}><b>{name(v.employee)}</b> : visite prévue le {fmtDate(v.scheduledOn)} non enregistrée (en retard).</p>)}
            {alerts.soon.map((v) => <p key={v.id}><b>{name(v.employee)}</b> : visite prévue le {fmtDate(v.scheduledOn)}.</p>)}
            {alerts.toSchedule.map((v) => <p key={v.id}><b>{name(v.employee)}</b> : échéance le {fmtDate(v.nextDueOn)} — <span className="font-medium">à programmer</span>.</p>)}
          </CardContent>
        </Card>
      )}
      <ListToolbar placeholder="Salarié, organisme…" filters={[
        { name: "statut", label: "Statut", options: VISIT_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
        { name: "type", label: "Type", options: VISIT_KINDS.map((s) => ({ value: s.value, label: s.label })) },
      ]}>
        <ExportLinks kind="hr-visites-medicales" params={{ q: lp.q || undefined, statut: status, type: kind }} />
        {ctx.can("hr.holiday.manage") && <PolicyDialog policy={policyForm(policy)} />}
        {manage && opts.length > 0 && <VisitDialog employees={opts} />}
      </ListToolbar>
      <SelectionBar />
      <p className="mb-3 text-xs text-muted-foreground">Suivi administratif uniquement : aucun résultat ni information médicale n&apos;est enregistré. Le document d&apos;aptitude se joint depuis la GED, en accès restreint. Les périodicités réglementaires ne sont pas présumées : saisissez la prochaine échéance à chaque visite.</p>
      {rows.length === 0 ? <EmptyState icon={<Stethoscope className="size-8" />} title="Aucune visite" description="Les visites programmées et réalisées apparaissent ici." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead>Type</TableHead><TableHead>Prévue</TableHead><TableHead>Réalisée</TableHead><TableHead>Prochaine échéance</TableHead><TableHead>Aptitude</TableHead><TableHead>Statut</TableHead><TableHead className="w-44"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium">{r.employee.lastName} {r.employee.firstName}<span className="block text-xs font-normal text-muted-foreground">{r.employee.number}{r.provider ? ` · ${r.provider}` : ""}</span></TableCell>
                  <TableCell className="text-sm">{label(VISIT_KINDS, r.kind)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{r.scheduledOn ? fmtDate(r.scheduledOn) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{r.doneOn ? fmtDate(r.doneOn) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{r.nextDueOn ? fmtDate(r.nextDueOn) : "—"}</TableCell>
                  <TableCell className="text-sm">{r.status !== "DONE" ? "—" : r.aptitudeDoc === "PROVIDED" ? "Reçu" : r.aptitudeDoc === "PENDING" ? "Attendu" : "Sans objet"}</TableCell>
                  <TableCell><StatusBadge tone={r.state === "overdue" ? "danger" : TONE[r.status as keyof typeof TONE]}>{r.state === "overdue" ? "En retard" : label(VISIT_STATUSES, r.status)}</StatusBadge></TableCell>
                  <TableCell>
                    {manage && r.status === "PLANNED" && (
                      <div className="flex items-center justify-end gap-1">
                        <CompleteVisitDialog id={r.id} />
                        <VisitDialog employees={[]} visit={{ id: r.id, kind: r.kind, scheduledOn: r.scheduledOn, provider: r.provider, notes: r.notes }} />
                        <ActionButton action={cancelVisitAction} input={{ id: r.id }} size="sm" variant="ghost" label="Annuler" success="Visite annulée" confirm={{ title: "Annuler cette visite ?", confirmLabel: "Annuler la visite" }} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/visites-medicales" searchParams={sp} />
    </ListScope>
  );
}
