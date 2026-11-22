import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { Ban, Hourglass, Send } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListScope, SelectionBar } from "@/components/app/data-list";
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
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { listOvertime, listOvertimeRates } from "@/modules/hr/overtime";
import { cancelOvertimeAction, submitOvertimeAction } from "@/modules/hr/registers-actions";
import { OVERTIME_SCOPE, scopeOf } from "@/modules/hr/scope";
import { AssignRateDialog, OvertimeDialog, OvertimeRateDialog } from "@/modules/hr/ui/admin-dialogs";
import { ExportLinks } from "@/modules/hr/ui/export-links";
import { DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";

export const metadata: Metadata = { title: "Heures supplémentaires" };
const STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export default async function OvertimePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  const scope = await scopeOf(ctx, OVERTIME_SCOPE);
  if (scope.kind === "none") forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const manage = ctx.can("hr.overtime.manage");
  const [{ rows, total }, rates, me] = await Promise.all([
    listOvertime(ctx, { status, q: lp.q || undefined, skip: lp.skip, take: lp.take }),
    listOvertimeRates(ctx, true),
    ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  const employees = manage
    ? (await ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } })).map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }))
    : me && ctx.can("hr.overtime.request") ? [{ value: me.id, label: `${me.firstName} ${me.lastName}` }] : [];
  const pending = rows.filter((r) => r.status === "PENDING").map((r) => r.id);
  const approvals = pending.length ? await ctx.db.approvalRequest.findMany({ where: { resourceType: "overtime", status: "PENDING", resourceId: { in: pending } }, include: { decisions: { select: { decidedById: true } } } }) : [];
  const approvalOf = new Map(approvals.map((a) => [a.resourceId, a]));
  const activeRates = rates.filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.name} (× ${num(r.multiplier)})` }));

  return (
    <ListScope filename="heures-supplementaires">
      <ListToolbar placeholder="Salarié, motif…" filters={[{ name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "PENDING", label: "En attente" }, { value: "APPROVED", label: "Approuvées" }, { value: "REJECTED", label: "Refusées" }, { value: "CANCELLED", label: "Annulées" }] }]}>
        <ExportLinks kind="hr-heures-supplementaires" params={{ q: lp.q || undefined, statut: status }} />
        {employees.length > 0 && <OvertimeDialog employees={employees} rates={activeRates} defaultEmployeeId={me?.id} canRate={manage} />}
      </ListToolbar>
      <SelectionBar />
      {rows.length === 0 ? <EmptyState icon={<Hourglass className="size-8" />} title="Aucune heure supplémentaire" description="Les déclarations d'heures supplémentaires apparaissent ici, avec leur validation hiérarchique." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Normales</TableHead><TableHead className="text-right">Supp.</TableHead><TableHead className="text-right">Approuvées</TableHead><TableHead>Taux</TableHead><TableHead>Statut</TableHead><TableHead className="w-56"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const appr = approvalOf.get(r.id);
                const own = r.employee.userId === ctx.user.id;
                const mayAct = own || manage;
                const cancellable = (own || ctx.can("hr.overtime.approve") || manage) && (r.status === "DRAFT" || r.status === "PENDING" || (r.status === "APPROVED" && manage));
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee.lastName} {r.employee.firstName}<span className="block text-xs font-normal text-muted-foreground">{r.employee.number}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.date)}<span className="block text-xs">{r.startTime}–{r.endTime}</span></TableCell>
                    <TableCell className="text-right text-sm tabular">{num(r.normalHours)} h</TableCell>
                    <TableCell className="text-right text-sm font-medium tabular">{num(r.hours)} h</TableCell>
                    <TableCell className="text-right text-sm tabular">{r.approvedHours == null ? "—" : `${num(r.approvedHours)} h`}</TableCell>
                    <TableCell className="text-sm">{r.rate ? `${r.rate.name} (× ${num(r.rate.multiplier)})` : <span className="text-muted-foreground">à définir</span>}</TableCell>
                    <TableCell><Status value={r.status} />{r.status === "REJECTED" && r.decisionComment && <span className="block text-xs text-muted-foreground">{r.decisionComment}</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {appr && canDecideRequest(ctx, appr) && <DecisionButtons id={appr.id} title={appr.title} />}
                        {manage && (r.status === "DRAFT" || r.status === "PENDING" || r.status === "APPROVED") && <AssignRateDialog id={r.id} rates={activeRates} current={r.rateId} />}
                        {r.status === "DRAFT" && mayAct && <><OvertimeDialog employees={[]} rates={activeRates} canRate={manage} overtime={{ id: r.id, date: r.date, startTime: r.startTime, endTime: r.endTime, rateId: r.rateId, reason: r.reason }} /><ActionButton action={submitOvertimeAction} input={{ id: r.id }} size="sm" variant="outline" label="Soumettre" icon={<Send className="size-4" />} success="Heures soumises" /></>}
                        {cancellable && <ActionButton action={cancelOvertimeAction} input={{ id: r.id }} size="sm" variant="ghost" label="" ariaLabel="Annuler" icon={<Ban className="size-4" />} success="Déclaration annulée" confirm={{ title: "Annuler cette déclaration ?", confirmLabel: "Annuler" }} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/heures-supplementaires" searchParams={sp} />
      {manage && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-base">Taux de majoration</CardTitle><OvertimeRateDialog /></CardHeader>
          <CardContent className="divide-y p-0">
            {rates.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun taux : ajoutez ceux de votre entreprise. Les coefficients dépendent de la réglementation et de votre convention : le logiciel n&apos;en présume aucun.</p>}
            {rates.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                <span className={`flex-1 font-medium ${t.isActive ? "" : "text-muted-foreground line-through"}`}>{t.name}</span>
                <span className="text-xs text-muted-foreground">× {num(t.multiplier)}{t.description ? ` · ${t.description}` : ""}</span>
                <OvertimeRateDialog rate={{ id: t.id, name: t.name, multiplier: num(t.multiplier), description: t.description, isActive: t.isActive }} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </ListScope>
  );
}
