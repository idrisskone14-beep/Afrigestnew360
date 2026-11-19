import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { Ban, Banknote, Send } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListScope, SelectionBar } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canDecideRequest } from "@/core/approvals";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { listAdvances } from "@/modules/hr/advances";
import { ADVANCE_KINDS } from "@/modules/hr/admin-schemas";
import { cancelAdvanceAction, submitAdvanceAction } from "@/modules/hr/registers-actions";
import { ADVANCE_SCOPE, scopeOf } from "@/modules/hr/scope";
import { AdvanceDialog, RepaymentDialog } from "@/modules/hr/ui/admin-dialogs";
import { ExportLinks } from "@/modules/hr/ui/export-links";
import { DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";

export const metadata: Metadata = { title: "Avances et acomptes" };
const STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export default async function AdvancesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  const scope = await scopeOf(ctx, ADVANCE_SCOPE);
  if (scope.kind === "none") forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const manage = ctx.can("hr.advance.manage");
  const cur = ctx.company.currency;
  const { rows, total } = await listAdvances(ctx, { status, q: lp.q || undefined, skip: lp.skip, take: lp.take });
  const me = await ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
  const employees = manage
    ? (await ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } })).map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }))
    : me && ctx.can("hr.advance.request") ? [{ value: me.id, label: `${me.firstName} ${me.lastName}` }] : [];
  const pending = rows.filter((r) => r.status === "PENDING").map((r) => r.id);
  const approvals = pending.length ? await ctx.db.approvalRequest.findMany({ where: { resourceType: "advance", status: "PENDING", resourceId: { in: pending } }, include: { decisions: { select: { decidedById: true } } } }) : [];
  const approvalOf = new Map(approvals.map((a) => [a.resourceId, a]));

  return (
    <ListScope filename="avances-acomptes">
      <ListToolbar placeholder="Salarié, matricule…" filters={[{ name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "PENDING", label: "En attente" }, { value: "APPROVED", label: "Approuvées" }, { value: "REJECTED", label: "Refusées" }, { value: "CANCELLED", label: "Annulées" }] }]}>
        <ExportLinks kind="hr-avances" params={{ q: lp.q || undefined, statut: status }} />
        {employees.length > 0 && <AdvanceDialog employees={employees} defaultEmployeeId={me?.id} currency={cur} />}
      </ListToolbar>
      <SelectionBar />
      <p className="mb-3 text-xs text-muted-foreground">La retenue sur bulletin de paie n&apos;est pas encore connectée : les remboursements se saisissent ici. Chaque retenue de paie future sera unique par avance et par mois (aucune double déduction possible).</p>
      {rows.length === 0 ? <EmptyState icon={<Banknote className="size-8" />} title="Aucune avance" description="Les demandes d'avance et d'acompte apparaissent ici, avec leur validation et leurs remboursements." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead>Nature</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Régularisation</TableHead><TableHead className="text-right">Reste</TableHead><TableHead>Statut</TableHead><TableHead className="w-56"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const appr = approvalOf.get(r.id);
                const own = r.employee.userId === ctx.user.id;
                const mayAct = own || manage;
                const cancellable = (own || ctx.can("hr.advance.approve") || manage) && r.repayments.length === 0 && (r.status === "DRAFT" || r.status === "PENDING" || (r.status === "APPROVED" && manage));
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee.lastName} {r.employee.firstName}<span className="block text-xs font-normal text-muted-foreground">{r.employee.number} · {fmtDate(r.requestDate)}</span></TableCell>
                    <TableCell className="text-sm">{ADVANCE_KINDS.find((k) => k.value === r.kind)?.label}{r.reason && <span className="block max-w-48 truncate text-xs text-muted-foreground" title={r.reason}>{r.reason}</span>}</TableCell>
                    <TableCell className="text-right text-sm tabular">{formatMoney(num(r.amount), cur)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.installments} mensualité(s) dès {fmtDate(r.firstDeductionMonth)}</TableCell>
                    <TableCell className="text-right text-sm font-medium tabular">{r.status === "APPROVED" ? formatMoney(r.balance.toNumber(), cur) : "—"}</TableCell>
                    <TableCell><Status value={r.status} />{r.status === "REJECTED" && r.decisionComment && <span className="block text-xs text-muted-foreground">{r.decisionComment}</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {appr && canDecideRequest(ctx, appr) && <DecisionButtons id={appr.id} title={appr.title} />}
                        {manage && r.status === "APPROVED" && r.balance.gt(0) && <RepaymentDialog advanceId={r.id} balance={r.balance.toNumber()} />}
                        {r.status === "DRAFT" && mayAct && <><AdvanceDialog employees={[]} currency={cur} advance={{ id: r.id, kind: r.kind, amount: num(r.amount), requestDate: r.requestDate, reason: r.reason, installments: r.installments, firstDeductionMonth: r.firstDeductionMonth }} /><ActionButton action={submitAdvanceAction} input={{ id: r.id }} size="sm" variant="outline" label="Soumettre" icon={<Send className="size-4" />} success="Demande soumise" /></>}
                        {cancellable && <ActionButton action={cancelAdvanceAction} input={{ id: r.id }} size="sm" variant="ghost" label="" ariaLabel="Annuler" icon={<Ban className="size-4" />} success="Demande annulée" confirm={{ title: "Annuler cette demande ?", confirmLabel: "Annuler" }} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/avances" searchParams={sp} />
    </ListScope>
  );
}
