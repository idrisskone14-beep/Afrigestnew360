import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { Ban, Clock, Send } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListScope, RowBox, SelectAllBox, SelectionBar } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canDecideRequest } from "@/core/approvals";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { cancelTimeOffAction, submitTimeOffAction } from "@/modules/hr/registers-actions";
import { scopeOf, TIMEOFF_SCOPE } from "@/modules/hr/scope";
import { listTimeOffTypes, listTimeOffs } from "@/modules/hr/timeoff";
import { ExportLinks } from "@/modules/hr/ui/export-links";
import { TimeOffDialog, TimeOffTypeDialog } from "@/modules/hr/ui/register-dialogs";
import { DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";

export const metadata: Metadata = { title: "Permissions" };
const STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
const hoursLabel = (h: number) => `${Math.floor(h)} h${h % 1 ? ` ${String(Math.round((h % 1) * 60)).padStart(2, "0")}` : ""}`;

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  const scope = await scopeOf(ctx, TIMEOFF_SCOPE);
  if (scope.kind === "none") forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const allTypes = await listTimeOffTypes(ctx, true);
  const typeId = allTypes.find((t) => t.id === param(sp, "type"))?.id;
  const { rows, total } = await listTimeOffs(ctx, { status, typeId, q: lp.q || undefined, skip: lp.skip, take: lp.take });
  const manage = ctx.can("hr.timeoff.manage");
  const me = await ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
  const employees = manage
    ? (await ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } })).map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }))
    : me && ctx.can("hr.timeoff.request") ? [{ value: me.id, label: `${me.firstName} ${me.lastName}` }] : [];
  const pending = rows.filter((r) => r.status === "PENDING").map((r) => r.id);
  const approvals = pending.length ? await ctx.db.approvalRequest.findMany({ where: { resourceType: "timeoff", status: "PENDING", resourceId: { in: pending } }, include: { decisions: { select: { decidedById: true } } } }) : [];
  const approvalOf = new Map(approvals.map((a) => [a.resourceId, a]));
  const activeTypes = allTypes.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }));
  const today = new Date();

  return (
    <ListScope filename="permissions">
      <ListToolbar placeholder="Salarié, motif…" filters={[
        { name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "PENDING", label: "En attente" }, { value: "APPROVED", label: "Approuvées" }, { value: "REJECTED", label: "Refusées" }, { value: "CANCELLED", label: "Annulées" }] },
        { name: "type", label: "Type", options: allTypes.map((t) => ({ value: t.id, label: t.name })) },
      ]}>
        <ExportLinks kind="hr-permissions" params={{ q: lp.q || undefined, statut: status, type: typeId }} />
        {employees.length > 0 && activeTypes.length > 0 && <TimeOffDialog employees={employees} types={activeTypes} defaultEmployeeId={me?.id} />}
      </ListToolbar>
      <SelectionBar />
      {rows.length === 0 ? <EmptyState icon={<Clock className="size-8" />} title="Aucune permission" description={allTypes.length === 0 ? (manage ? "Créez d'abord un type de permission (en bas de page), puis enregistrez les demandes." : "Aucun type de permission n'est encore configuré : contactez les ressources humaines.") : "Les demandes de permission apparaissent ici."} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-10"><SelectAllBox /></TableHead><TableHead>Salarié</TableHead><TableHead>Type</TableHead><TableHead>Période</TableHead><TableHead className="text-right">Durée</TableHead><TableHead>Statut</TableHead><TableHead className="w-56"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const appr = approvalOf.get(r.id);
                const own = r.employee.userId === ctx.user.id;
                const mayAct = own || manage;
                const cancellable = (own || ctx.can("hr.timeoff.approve") || manage) && (r.status === "DRAFT" || r.status === "PENDING" || (r.status === "APPROVED" && (r.startDate > today || manage)));
                return (
                  <TableRow key={r.id}><TableCell><RowBox id={r.id} /></TableCell>
                    <TableCell className="text-sm font-medium">{r.employee.lastName} {r.employee.firstName}<span className="block text-xs font-normal text-muted-foreground">{r.employee.number}</span></TableCell>
                    <TableCell className="text-sm">{r.type.name}<span className="block text-xs text-muted-foreground">{r.paid ? "rémunérée" : "non rémunérée"}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.startDate)}{r.startTime ? ` ${r.startTime}` : ""} → {fmtDate(r.endDate)}{r.endTime ? ` ${r.endTime}` : ""}</TableCell>
                    <TableCell className="text-right text-sm tabular">{r.unit === "DAILY" ? `${num(r.days)} j` : hoursLabel(num(r.hours))}</TableCell>
                    <TableCell><Status value={r.status} />{r.status === "REJECTED" && r.decisionComment && <span className="block text-xs text-muted-foreground">{r.decisionComment}</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {appr && canDecideRequest(ctx, appr) && <DecisionButtons id={appr.id} title={appr.title} />}
                        {r.status === "DRAFT" && mayAct && <ActionButton action={submitTimeOffAction} input={{ id: r.id }} size="sm" variant="outline" label="Soumettre" icon={<Send className="size-4" />} success="Permission soumise" />}
                        {cancellable && <ActionButton action={cancelTimeOffAction} input={{ id: r.id }} size="sm" variant="ghost" label="Annuler" icon={<Ban className="size-4" />} success="Permission annulée" confirm={{ title: "Annuler cette permission ?", confirmLabel: "Annuler la permission" }} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/permissions" searchParams={sp} />

      {manage && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-base">Types de permission</CardTitle><TimeOffTypeDialog /></CardHeader>
          <CardContent className="divide-y p-0">
            {allTypes.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun type : ajoutez ceux de votre entreprise (mariage, décès d'un proche, rendez-vous médical…). Les durées accordées dépendent de votre convention : le logiciel n'en présume aucune.</p>}
            {allTypes.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                <span className={`flex-1 font-medium ${t.isActive ? "" : "text-muted-foreground line-through"}`}>{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.paid ? "Rémunérée" : "Non rémunérée"}{t.maxDays ? ` · max ${num(t.maxDays)} j` : ""}{t.requiresProof ? " · justificatif" : ""}</span>
                <TimeOffTypeDialog type={{ id: t.id, name: t.name, paid: t.paid, requiresProof: t.requiresProof, maxDays: t.maxDays ? num(t.maxDays) : null, isActive: t.isActive }} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </ListScope>
  );
}
