import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { ListScope, SelectionBar } from "@/components/app/data-list";
import { KpiCards } from "@/components/app/kpi-cards";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { accidentDashboard, listAccidents } from "@/modules/hr/accidents";
import { loadPolicy, policyForm } from "@/modules/hr/policy";
import { ACCIDENT_KINDS, ACCIDENT_STATUSES, CNPS_STATUSES } from "@/modules/hr/registers-schemas";
import { AccidentDialog, PolicyDialog } from "@/modules/hr/ui/register-dialogs";
import { ExportLinks } from "@/modules/hr/ui/export-links";

export const metadata: Metadata = { title: "Accidents de travail" };
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;
const CNPS_TONE = { TO_DECLARE: "warning", DECLARED: "info", ACKNOWLEDGED: "success", NOT_REQUIRED: "neutral" } as const;
const STATUS_TONE = { OPEN: "info", CLOSED: "success", ARCHIVED: "neutral" } as const;

export default async function AccidentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.accident.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const thisYear = new Date().getUTCFullYear();
  const year = Number(param(sp, "annee")) || thisYear;
  const filters = { q: lp.q || undefined, status: enumParam(sp, "statut", ["OPEN", "CLOSED", "ARCHIVED"] as const), kind: enumParam(sp, "type", ["WORKPLACE", "COMMUTE", "MISSION"] as const), cnps: enumParam(sp, "cnps", ["TO_DECLARE", "DECLARED", "ACKNOWLEDGED", "NOT_REQUIRED"] as const) };
  const manage = ctx.can("hr.accident.manage");
  const [{ rows, total }, dash, employees, policy] = await Promise.all([
    listAccidents(ctx, { ...filters, year: param(sp, "annee") ? year : undefined, skip: lp.skip, take: lp.take }),
    accidentDashboard(ctx, year),
    manage ? ctx.db.employee.findMany({ where: { deletedAt: null }, select: { id: true, firstName: true, lastName: true, number: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
    loadPolicy(ctx.db),
  ]);
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - i));

  return (
    <ListScope filename="accidents-de-travail">
      <KpiCards items={[
        { label: `Accidents ${year}`, amount: String(dash.total), count: dash.open, tag: "ouverts", tone: "blue" },
        { label: "Avec arrêt de travail", amount: String(dash.withStop), tag: `${dash.stopDays} jour(s) d'arrêt`, tone: "amber" },
        { label: "Déclarations CNPS à faire", amount: String(dash.toDeclare), tone: dash.toDeclare ? "red" : "green" },
        { label: "Dossiers incomplets", amount: String(dash.incomplete), tone: dash.incomplete ? "red" : "green" },
      ]} />
      {dash.total > 0 && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="flex h-16 items-end gap-1" role="img" aria-label={`Accidents par mois en ${year}`}>
              {dash.byMonth.map((m) => <div key={m.month} title={`${m.month}/${year} : ${m.count}`} className="w-3 rounded-t bg-brand/70" style={{ height: `${Math.max(4, (m.count / Math.max(1, ...dash.byMonth.map((x) => x.count))) * 100)}%`, opacity: m.count ? 1 : 0.25 }} />)}
            </div>
            <p className="text-sm text-muted-foreground">Travail : <b className="text-foreground">{dash.byKind.WORKPLACE}</b> · Trajet : <b className="text-foreground">{dash.byKind.COMMUTE}</b> · Mission : <b className="text-foreground">{dash.byKind.MISSION}</b></p>
          </div>
        </Card>
      )}
      <ListToolbar placeholder="Dossier, salarié, lieu…" filters={[
        { name: "statut", label: "Statut", options: ACCIDENT_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
        { name: "type", label: "Nature", options: ACCIDENT_KINDS.map((s) => ({ value: s.value, label: s.label })) },
        { name: "cnps", label: "CNPS", options: CNPS_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
        { name: "annee", label: "Année", options: years.map((y) => ({ value: y, label: y })) },
      ]}>
        <ExportLinks kind="hr-accidents" params={{ q: filters.q, statut: filters.status, type: filters.kind, cnps: filters.cnps }} />
        {ctx.can("hr.holiday.manage") && <PolicyDialog policy={policyForm(policy)} />}
        {manage && <AccidentDialog employees={employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName} (${e.number})` }))} />}
      </ListToolbar>
      <SelectionBar />
      {rows.length === 0 ? <EmptyState icon={<ShieldAlert className="size-8" />} title="Aucun accident enregistré" description={manage ? "Déclarez un accident pour ouvrir son dossier : circonstances, déclaration CNPS, arrêt de travail et pièces." : "Les dossiers d'accident apparaissent ici."} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Dossier</TableHead><TableHead>Date</TableHead><TableHead>Salarié</TableHead><TableHead>Nature</TableHead><TableHead>Arrêt</TableHead><TableHead>CNPS</TableHead><TableHead>Statut</TableHead><TableHead>Alertes</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const blocking = r.gaps.filter((g) => g.blocking);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm font-medium"><Link href={`/app/hr/accidents/${r.id}`} className="hover:text-brand">{r.number}</Link></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.occurredOn)}{r.occurredTime ? ` ${r.occurredTime}` : ""}</TableCell>
                    <TableCell className="text-sm">{r.employeeName}<span className="block text-xs text-muted-foreground">{r.employeeNumber}{r.departmentName ? ` · ${r.departmentName}` : ""}</span></TableCell>
                    <TableCell className="text-sm">{label(ACCIDENT_KINDS, r.kind)}{r.category && <span className="block text-xs text-muted-foreground">{r.category}</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{r.workStop ? (r.stopStart ? `${fmtDate(r.stopStart)} → ${r.stopEnd ? fmtDate(r.stopEnd) : "en cours"}` : "Oui") : "Non"}</TableCell>
                    <TableCell><StatusBadge tone={CNPS_TONE[r.cnpsStatus as keyof typeof CNPS_TONE]}>{label(CNPS_STATUSES, r.cnpsStatus)}</StatusBadge></TableCell>
                    <TableCell><StatusBadge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE]}>{label(ACCIDENT_STATUSES, r.status)}</StatusBadge></TableCell>
                    <TableCell className="text-sm">{blocking.length > 0 ? <span title={blocking.map((g) => g.message).join("\n")} className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-4" />{blocking.length}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/accidents" searchParams={sp} />
    </ListScope>
  );
}
