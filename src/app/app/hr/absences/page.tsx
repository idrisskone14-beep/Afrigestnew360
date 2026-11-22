import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { Ban, UserX } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListScope, RowBox, SelectAllBox, SelectionBar } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status, StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canDecideRequest } from "@/core/approvals";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { listAbsenceTypes, listAbsences, repeatedAbsences } from "@/modules/hr/absences";
import { cancelAbsenceAction } from "@/modules/hr/registers-actions";
import { ABSENCE_CATEGORIES, JUSTIFICATIONS } from "@/modules/hr/registers-schemas";
import { ABSENCE_SCOPE, scopeOf } from "@/modules/hr/scope";
import { ExportLinks } from "@/modules/hr/ui/export-links";
import { AbsenceDialog, AbsenceTypeDialog, JustifyDialog } from "@/modules/hr/ui/register-dialogs";
import { DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";

export const metadata: Metadata = { title: "Absences" };
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;
const JUST_TONE = { NOT_REQUIRED: "neutral", PENDING: "warning", PROVIDED: "info", ACCEPTED: "success", REFUSED: "danger" } as const;

export default async function AbsencesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  const scope = await scopeOf(ctx, ABSENCE_SCOPE);
  if (scope.kind === "none") forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const);
  const category = enumParam(sp, "categorie", ["JUSTIFIED", "UNJUSTIFIED", "SICK", "EXCEPTIONAL", "OTHER"] as const);
  const justification = enumParam(sp, "justificatif", ["NOT_REQUIRED", "PENDING", "PROVIDED", "ACCEPTED", "REFUSED"] as const);
  const types = await listAbsenceTypes(ctx, true);
  const typeId = types.find((t) => t.id === param(sp, "motif"))?.id;
  const manage = ctx.can("hr.absence.manage");
  const [{ rows, total }, repeated, employees] = await Promise.all([
    listAbsences(ctx, { status, category, justification, typeId, q: lp.q || undefined, skip: lp.skip, take: lp.take }),
    repeatedAbsences(ctx),
    manage ? ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);
  const pending = rows.filter((r) => r.status === "PENDING").map((r) => r.id);
  const approvals = pending.length ? await ctx.db.approvalRequest.findMany({ where: { resourceType: "absence", status: "PENDING", resourceId: { in: pending } }, include: { decisions: { select: { decidedById: true } } } }) : [];
  const approvalOf = new Map(approvals.map((a) => [a.resourceId, a]));
  const activeTypes = types.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }));

  return (
    <ListScope filename="absences">
      {repeated.length > 0 && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardHeader><CardTitle className="text-base">Absences répétées</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {repeated.map((r) => <p key={r.employeeId}><b>{r.name}</b> ({r.number}) : {r.occurrences} absence(s) injustifiée(s), {r.days} jour(s), sur la période de suivi.</p>)}
            <p className="pt-1 text-xs text-muted-foreground">Signal destiné à la RH. Il ne déclenche aucune sanction ni retenue : toute mesure suppose une décision et la procédure applicable.</p>
          </CardContent>
        </Card>
      )}
      <ListToolbar placeholder="Salarié, observation…" filters={[
        { name: "statut", label: "Statut", options: [{ value: "PENDING", label: "En attente" }, { value: "APPROVED", label: "Validées" }, { value: "REJECTED", label: "Refusées" }, { value: "CANCELLED", label: "Annulées" }] },
        { name: "categorie", label: "Catégorie", options: ABSENCE_CATEGORIES.map((c) => ({ value: c.value, label: c.label })) },
        { name: "justificatif", label: "Justificatif", options: JUSTIFICATIONS.map((c) => ({ value: c.value, label: c.label })) },
        { name: "motif", label: "Motif", options: types.map((t) => ({ value: t.id, label: t.name })) },
      ]}>
        <ExportLinks kind="hr-absences" params={{ q: lp.q || undefined, statut: status, categorie: category, justificatif: justification, motif: typeId }} />
        {manage && employees.length > 0 && activeTypes.length > 0 && <AbsenceDialog employees={employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }))} types={activeTypes} />}
      </ListToolbar>
      <SelectionBar />
      {rows.length === 0 ? <EmptyState icon={<UserX className="size-8" />} title="Aucune absence" description={types.length === 0 && manage ? "Créez d'abord les motifs d'absence de l'entreprise (en bas de page), puis enregistrez les absences." : "Les absences enregistrées apparaissent ici."} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-10"><SelectAllBox /></TableHead><TableHead>Salarié</TableHead><TableHead>Motif</TableHead><TableHead>Période</TableHead><TableHead className="text-right">Jours</TableHead><TableHead>Justificatif</TableHead><TableHead>Statut</TableHead><TableHead className="w-52"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const appr = approvalOf.get(r.id);
                return (
                  <TableRow key={r.id}><TableCell><RowBox id={r.id} /></TableCell>
                    <TableCell className="text-sm font-medium"><Link href={ctx.can("hr.employee.read") ? `/app/hr/salaries/${r.employee.id}` : "/app/hr/absences"} className="hover:text-brand">{r.employee.lastName} {r.employee.firstName}</Link><span className="block text-xs font-normal text-muted-foreground">{r.employee.number}</span></TableCell>
                    <TableCell className="text-sm">{r.type.name}<span className="block text-xs text-muted-foreground">{label(ABSENCE_CATEGORIES, r.type.category)}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.startDate)}{r.startDate.getTime() !== r.endDate.getTime() ? ` → ${fmtDate(r.endDate)}` : r.halfDay ? " (demi-journée)" : ""}</TableCell>
                    <TableCell className="text-right text-sm tabular">{num(r.days)}</TableCell>
                    <TableCell><StatusBadge tone={JUST_TONE[r.justification as keyof typeof JUST_TONE]}>{label(JUSTIFICATIONS, r.justification)}</StatusBadge>{r.hrNote && <span className="block text-xs text-muted-foreground">{r.hrNote}</span>}</TableCell>
                    <TableCell><Status value={r.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {appr && canDecideRequest(ctx, appr) && <DecisionButtons id={appr.id} title={appr.title} />}
                        {manage && r.status !== "CANCELLED" && r.status !== "REJECTED" && <JustifyDialog kind="absence" id={r.id} current={r.justification} note={r.hrNote} />}
                        {manage && !r.type.requiresValidation && r.status === "APPROVED" && <AbsenceDialog employees={[]} types={activeTypes} absence={{ id: r.id, typeId: r.typeId, startDate: r.startDate, endDate: r.endDate, halfDay: r.halfDay, reason: r.reason }} />}
                        {(manage || ctx.can("hr.absence.approve")) && (r.status === "PENDING" || r.status === "APPROVED") && <ActionButton action={cancelAbsenceAction} input={{ id: r.id }} size="sm" variant="ghost" label="" ariaLabel="Annuler l'absence" icon={<Ban className="size-4" />} success="Absence annulée" confirm={{ title: "Annuler cette absence ?", confirmLabel: "Annuler l'absence" }} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/absences" searchParams={sp} />

      {manage && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-base">Motifs d'absence</CardTitle><AbsenceTypeDialog /></CardHeader>
          <CardContent className="divide-y p-0">
            {types.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun motif : ajoutez ceux de votre entreprise (justifiée, injustifiée, maladie, exceptionnelle…).</p>}
            {types.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                <span className={`flex-1 font-medium ${t.isActive ? "" : "text-muted-foreground line-through"}`}>{t.name}</span>
                <span className="text-xs text-muted-foreground">{label(ABSENCE_CATEGORIES, t.category)}{t.requiresValidation ? " · validation" : ""}{t.requiresProof ? " · justificatif" : ""}</span>
                <AbsenceTypeDialog type={{ id: t.id, name: t.name, category: t.category, requiresValidation: t.requiresValidation, requiresProof: t.requiresProof, isActive: t.isActive }} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </ListScope>
  );
}
