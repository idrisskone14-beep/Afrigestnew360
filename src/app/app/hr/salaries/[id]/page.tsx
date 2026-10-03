import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Mail, MapPin, Phone } from "lucide-react";
import { QueryTabs } from "@/components/app/query-tabs";
import { Status, StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { enumParam, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { canSeePay, getEmployee, listContracts } from "@/modules/hr/employees";
import { leaveBalances } from "@/modules/hr/leave";
import { CONTRACT_TYPES, PAYOUT_METHODS } from "@/modules/hr/schemas";
import { ContractDialog, EmployeeFormDialog, TerminateDialog } from "@/modules/hr/ui/employee-dialogs";
import { DeleteEvaluationButton, DeleteTrainingButton, EvaluationDialog, TrainingDialog } from "@/modules/hr/ui/evaluation-panels";
import { toInputDate } from "@/lib/format";
import { ActionButton } from "@/components/app/action-button";
import { removeEmployeeItemAction } from "@/modules/payroll/actions";
import { EmployeeItemDialog } from "@/modules/payroll/ui/item-dialogs";
import { Trash2 } from "lucide-react";

export const metadata: Metadata = { title: "Fiche salarié" };
const TABS = ["resume", "contrats", "conges", "evaluations", "formations", "paie"] as const;

export default async function EmployeeDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("hr.employee.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const e = await getEmployee(ctx, id).catch((x) => { if (x instanceof AppError && x.code === "NOT_FOUND") notFound(); throw x; });
  const sp = await searchParams;
  const pay = canSeePay(ctx);
  const canEval = ctx.can("hr.evaluation.manage");
  const tabs = [
    { key: "resume", label: "Résumé" },
    ...(pay ? [{ key: "contrats", label: "Contrats" }] : []),
    { key: "conges", label: "Congés" },
    ...(canEval ? [{ key: "evaluations", label: "Évaluations" }, { key: "formations", label: "Formations" }] : []),
    ...(ctx.hasModule("payroll") && ctx.can("hr.payroll.manage") ? [{ key: "paie", label: "Paie" }] : []),
  ];
  const tab = enumParam(sp, "onglet", TABS) ?? "resume";
  const cur = e.currency;
  const edit = ctx.can("hr.employee.update") && e.status !== "TERMINATED";
  const base = `/app/hr/salaries/${id}`;

  const [departments, branches, managers, members] = edit ? await Promise.all([
    ctx.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.employee.findMany({ where: { deletedAt: null, status: { not: "TERMINATED" } }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }),
    ctx.db.companyMembership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, user: { select: { name: true, email: true } } } }),
  ]) : [[], [], [], []];
  const linked = e.userId ? await ctx.db.companyMembership.findFirst({ where: { userId: e.userId }, select: { user: { select: { name: true, email: true } } } }) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/hr/salaries" className="hover:text-foreground">Salariés</Link> / {e.number}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{e.firstName} {e.lastName} <Status value={e.status} /></h2>
          <p className="mt-1 text-sm text-muted-foreground">{[e.jobTitle, e.department?.name, e.branch?.name].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {edit && <EmployeeFormDialog canPay={pay} departments={departments} branches={branches} managers={managers.map((m) => ({ id: m.id, name: `${m.lastName} ${m.firstName}` }))} users={members.map((m) => ({ id: m.userId, name: `${m.user.name} (${m.user.email})` }))}
            employee={{ id: e.id, firstName: e.firstName, lastName: e.lastName, email: e.email ?? "", phone: e.phone ?? "", birthDate: toInputDate(e.birthDate), nationalId: e.nationalId ?? "", address: e.address ?? "", city: e.city ?? "", hireDate: toInputDate(e.hireDate), jobTitle: e.jobTitle ?? "", departmentId: e.departmentId ?? "", branchId: e.branchId ?? "", managerId: e.managerId ?? "", userId: e.userId ?? "", baseSalary: e.baseSalary ? num(e.baseSalary) : 0, payoutMethod: e.payoutMethod, payoutReference: e.payoutReference ?? "" }} />}
          {edit && <TerminateDialog employeeId={e.id} name={`${e.firstName} ${e.lastName}`} />}
        </div>
      </div>

      <QueryTabs tabs={tabs} current={tabs.some((t) => t.key === tab) ? tab : "resume"} basePath={base} label="Sections de la fiche salarié" />

      {tab === "resume" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Coordonnées</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{e.email ? <a href={`mailto:${e.email}`} className="hover:text-brand">{e.email}</a> : "—"}</p>
              <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />{e.phone ?? "—"}</p>
              <p className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" />{[e.address, e.city].filter(Boolean).join(", ") || "—"}</p>
              <p className="text-xs text-muted-foreground">Compte utilisateur : {linked ? `${linked.user.name} (${linked.user.email})` : "aucun (pas d'accès en libre-service)"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Emploi</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Embauche">{fmtDate(e.hireDate)}</Info>
              <Info label="Sortie">{e.endDate ? `${fmtDate(e.endDate)}${e.terminationReason ? ` — ${e.terminationReason}` : ""}` : "—"}</Info>
              <Info label="Responsable">{e.manager ? <Link href={`/app/hr/salaries/${e.manager.id}`} className="hover:text-brand">{e.manager.firstName} {e.manager.lastName}</Link> : "—"}</Info>
              <Info label="Naissance">{fmtDate(e.birthDate)}</Info>
              {pay && <Info label="Salaire de base">{e.baseSalary ? formatMoney(num(e.baseSalary), cur) : "—"}</Info>}
              {pay && <Info label="Paiement">{PAYOUT_METHODS.find((m) => m.value === e.payoutMethod)?.label}{e.payoutReference ? ` · ${e.payoutReference}` : ""}</Info>}
              {pay && <Info label="Pièce d'identité">{e.nationalId ?? "—"}</Info>}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "contrats" && pay && <ContractsTab ctxId={id} cur={cur} canAdd={ctx.can("hr.contract.manage") && e.status !== "TERMINATED"} salary={e.baseSalary ? num(e.baseSalary) : 0} ctx={ctx} />}
      {tab === "conges" && <LeaveTab ctx={ctx} employeeId={id} />}
      {tab === "evaluations" && canEval && <EvaluationsTab ctx={ctx} employeeId={id} active={e.status !== "TERMINATED"} />}
      {tab === "paie" && ctx.hasModule("payroll") && ctx.can("hr.payroll.manage") && <PayTab ctx={ctx} employeeId={id} cur={cur} active={e.status !== "TERMINATED"} />}
      {tab === "formations" && canEval && <TrainingsTab ctx={ctx} employeeId={id} cur={cur} active={e.status !== "TERMINATED"} />}
      {tab === "resume" && <EntityDocuments ctx={ctx} type="employee" id={id} />}
    </div>
  );
}

type PageCtx = Awaited<ReturnType<typeof requirePagePermission>>;
const Info = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{children}</p></div>;

async function ContractsTab({ ctxId, ctx, cur, canAdd, salary }: { ctxId: string; ctx: PageCtx; cur: string; canAdd: boolean; salary: number }) {
  const contracts = await listContracts(ctx, ctxId);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Historique des contrats</CardTitle>{canAdd && <ContractDialog employeeId={ctxId} currentSalary={salary} />}</CardHeader>
      <CardContent className="p-0">
        {contracts.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun contrat enregistré.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Début</TableHead><TableHead>Fin</TableHead><TableHead className="hidden sm:table-cell">Poste</TableHead><TableHead className="text-right">Salaire</TableHead></TableRow></TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}><TableCell className="text-sm font-medium">{CONTRACT_TYPES.find((t) => t.value === c.type)?.label}</TableCell><TableCell className="text-sm">{fmtDate(c.startDate)}</TableCell><TableCell className="text-sm">{c.endDate ? fmtDate(c.endDate) : "en cours"}</TableCell><TableCell className="hidden text-sm sm:table-cell">{c.jobTitle ?? "—"}</TableCell><TableCell className="text-right text-sm tabular">{formatMoney(num(c.salary), cur)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function LeaveTab({ ctx, employeeId }: { ctx: PageCtx; employeeId: string }) {
  const year = new Date().getUTCFullYear();
  const [balances, reqs] = await Promise.all([
    leaveBalances(ctx, employeeId, year),
    ctx.db.leaveRequest.findMany({ where: { employeeId }, orderBy: { startDate: "desc" }, take: 20, include: { type: { select: { name: true } } } }),
  ]);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {balances.map((b) => (
          <Card key={b.type.id}><CardContent className="space-y-0.5 p-4"><p className="text-xs text-muted-foreground">{b.type.name} {year}</p><p className="text-lg font-semibold tabular">{b.remaining ? `${b.remaining.toNumber()} j restants` : `${b.taken.toNumber()} j pris`}</p><p className="text-xs text-muted-foreground">{b.entitlement ? `sur ${b.entitlement.toNumber()} · ` : ""}{b.pending.toNumber()} en attente</p></CardContent></Card>
        ))}
      </div>
      <Card className="divide-y p-0">
        {reqs.length === 0 && <p className="px-6 py-6 text-sm text-muted-foreground">Aucune demande de congé.</p>}
        {reqs.map((r) => (
          <Link key={r.id} href={`/app/hr/conges?statut=${r.status}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{r.type.name} · {num(r.days)} j</span><span className="text-xs text-muted-foreground">{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</span><Status value={r.status} /></Link>
        ))}
      </Card>
    </div>
  );
}

async function PayTab({ ctx, employeeId, cur, active }: { ctx: PageCtx; employeeId: string; cur: string; active: boolean }) {
  const [items, slips] = await Promise.all([
    ctx.db.employeePayrollItem.findMany({ where: { employeeId, isActive: true }, orderBy: { startDate: "desc" } }),
    ctx.db.payslip.findMany({ where: { employeeId, run: { status: { in: ["VALIDATED", "PAID"] } } }, orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }], take: 12, include: { run: { select: { year: true, month: true } } } }),
  ]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Primes et retenues récurrentes</CardTitle>{active && <EmployeeItemDialog employeeId={employeeId} />}</CardHeader>
        <CardContent className="divide-y p-0">
          {items.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun élément individuel : seules les rubriques de l'entreprise s'appliquent.</p>}
          {items.map((x) => (
            <div key={x.id} className="flex items-center gap-3 px-6 py-3">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{x.name} <StatusBadge tone={x.type === "EARNING" ? "success" : "warning"}>{x.type === "EARNING" ? "Prime" : "Retenue"}</StatusBadge></p><p className="text-xs text-muted-foreground">{formatMoney(num(x.amount), cur)} / mois · du {fmtDate(x.startDate)}{x.endDate ? ` au ${fmtDate(x.endDate)}` : ""}</p></div>
              <ActionButton action={removeEmployeeItemAction} input={{ id: x.id }} variant="ghost" size="sm" label="Retirer" icon={<Trash2 className="size-4" />} success="Élément retiré" confirm={{ title: "Retirer cet élément ?", description: "Il ne figurera plus sur les prochains bulletins (les bulletins déjà validés ne changent pas)." }} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="divide-y p-0">
        <p className="px-6 py-3 text-sm font-semibold">Derniers bulletins</p>
        {slips.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun bulletin validé.</p>}
        {slips.map((p) => <a key={p.id} href={`/api/pdf/payslip/${p.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{String(p.run.month).padStart(2, "0")}/{p.run.year} · {p.number}</span><span className="tabular text-sm">{formatMoney(num(p.netPay), cur)}</span></a>)}
      </Card>
    </div>
  );
}

async function EvaluationsTab({ ctx, employeeId, active }: { ctx: PageCtx; employeeId: string; active: boolean }) {
  const rows = await ctx.db.evaluation.findMany({ where: { employeeId }, orderBy: { date: "desc" } });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Évaluations</CardTitle>{active && <EvaluationDialog employeeId={employeeId} />}</CardHeader>
      <CardContent className="divide-y p-0">
        {rows.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune évaluation.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-6 py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{r.period} <StatusBadge tone={r.score >= 4 ? "success" : r.score >= 3 ? "info" : "warning"}>{r.score}/5</StatusBadge></p><p className="text-xs text-muted-foreground">{fmtDate(r.date)}</p>{r.objectives && <p className="mt-1 text-sm"><span className="text-muted-foreground">Objectifs : </span>{r.objectives}</p>}{r.comments && <p className="mt-1 text-sm">{r.comments}</p>}</div>
            <DeleteEvaluationButton id={r.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

async function TrainingsTab({ ctx, employeeId, cur, active }: { ctx: PageCtx; employeeId: string; cur: string; active: boolean }) {
  const rows = await ctx.db.training.findMany({ where: { employeeId }, orderBy: { date: "desc" } });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Formations</CardTitle>{active && <TrainingDialog employeeId={employeeId} />}</CardHeader>
      <CardContent className="divide-y p-0">
        {rows.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune formation.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-6 py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{fmtDate(r.date)}{r.provider ? ` · ${r.provider}` : ""} · {num(r.hours)} h{num(r.cost) ? ` · ${formatMoney(num(r.cost), cur)}` : ""}</p></div>
            <DeleteTrainingButton id={r.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
