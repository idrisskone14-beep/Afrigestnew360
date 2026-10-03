import type { Metadata } from "next";
import Link from "next/link";
import { Ban, CalendarDays } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canDecide } from "@/core/approvals";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { forbidden } from "next/navigation";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { cancelLeaveAction } from "@/modules/hr/actions";
import { employeeOfUser } from "@/modules/hr/employees";
import { leaveBalances, listLeaveRequests, listLeaveTypes, seesAllLeaves } from "@/modules/hr/leave";
import { LeaveRequestDialog, LeaveTypesDialog } from "@/modules/hr/ui/leave-dialogs";
import { DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";

export const metadata: Metadata = { title: "Congés" };
const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export default async function LeavesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.leave.read") && !ctx.can("hr.leave.request")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const allTypes = await listLeaveTypes(ctx, true);
  const typeId = allTypes.find((t) => t.id === param(sp, "type"))?.id;
  const { rows, total } = await listLeaveRequests(ctx, { status, typeId, skip: lp.skip, take: lp.take });
  const me = await employeeOfUser(ctx);
  const hrMode = ctx.can("hr.employee.update");
  const employees = hrMode
    ? (await ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } })).map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` }))
    : me && ctx.can("hr.leave.request") ? [{ id: me.id, name: `${me.firstName} ${me.lastName}` }] : [];
  const balances = me ? await leaveBalances(ctx, me.id, new Date().getUTCFullYear()) : [];
  const approvals = ctx.can("hr.leave.approve") && rows.length ? await ctx.db.approvalRequest.findMany({ where: { resourceType: "leave", status: "PENDING", resourceId: { in: rows.map((r) => r.id) } } }) : [];
  const approvalOf = new Map(approvals.map((a) => [a.resourceId, a]));
  const today = new Date();

  return (
    <>
      <ListToolbar placeholder="Rechercher…" filters={[
        { name: "statut", label: "Statut", options: [{ value: "PENDING", label: "En attente" }, { value: "APPROVED", label: "Approuvés" }, { value: "REJECTED", label: "Refusés" }, { value: "CANCELLED", label: "Annulés" }] },
        { name: "type", label: "Type", options: allTypes.map((t) => ({ value: t.id, label: t.name })) },
      ]}>
        {hrMode && <LeaveTypesDialog types={allTypes.map((t) => ({ id: t.id, name: t.name, annualDays: num(t.annualDays), paid: t.paid, isActive: t.isActive }))} />}
        {employees.length > 0 && <LeaveRequestDialog employees={employees} types={allTypes.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name }))} defaultEmployeeId={me?.id} />}
      </ListToolbar>

      {balances.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {balances.map((b) => <Card key={b.type.id}><CardContent className="space-y-0.5 p-4"><p className="text-xs text-muted-foreground">Mes jours — {b.type.name}</p><p className="text-lg font-semibold tabular">{b.remaining ? `${b.remaining.toNumber()} j restants` : `${b.taken.toNumber()} j pris`}</p><p className="text-xs text-muted-foreground">{b.entitlement ? `sur ${b.entitlement.toNumber()} · ` : ""}{b.pending.toNumber()} en attente</p></CardContent></Card>)}
        </div>
      )}

      {rows.length === 0 ? <EmptyState icon={<CalendarDays className="size-8" />} title="Aucune demande de congé" description={seesAllLeaves(ctx) ? "Les demandes de l'équipe apparaissent ici." : "Vos demandes apparaissent ici."} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead>Type</TableHead><TableHead>Période</TableHead><TableHead className="text-right">Jours</TableHead><TableHead>Statut</TableHead><TableHead className="w-48"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const appr = approvalOf.get(r.id);
                const mine = r.employee.id === me?.id;
                const cancellable = (mine || ctx.can("hr.leave.approve") || hrMode) && (r.status === "PENDING" || (r.status === "APPROVED" && r.startDate > today));
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm"><Link href={ctx.can("hr.employee.read") ? `/app/hr/salaries/${r.employee.id}?onglet=conges` : "/app/hr/conges"} className="font-medium hover:text-brand">{r.employee.lastName} {r.employee.firstName}</Link></TableCell>
                    <TableCell className="text-sm">{r.type.name}{!r.type.paid && <span className="block text-xs text-muted-foreground">non payé</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</TableCell>
                    <TableCell className="text-right text-sm tabular">{num(r.days)}</TableCell>
                    <TableCell><Status value={r.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {appr && canDecide(ctx, "leave") && appr.requestedById !== ctx.user.id && <DecisionButtons id={appr.id} title={appr.title} />}
                        {cancellable && <ActionButton action={cancelLeaveAction} input={{ id: r.id }} size="sm" variant="ghost" label="Annuler" icon={<Ban className="size-4" />} success="Demande annulée" confirm={{ title: "Annuler cette demande ?", confirmLabel: "Annuler la demande" }} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/conges" searchParams={sp} />
    </>
  );
}
