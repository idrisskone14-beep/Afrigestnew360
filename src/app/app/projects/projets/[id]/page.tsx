import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FileText } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { QueryTabs } from "@/components/app/query-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate, toInputDate } from "@/lib/format";
import { enumParam, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { invoiceTimeAction } from "@/modules/projects/actions";
import { getProject, listTasks, listTime, myEmployee, projectSummary } from "@/modules/projects/service";
import { Gantt, type GanttTask } from "@/modules/projects/ui/gantt";
import { ProjectFormDialog, ProjectStatusSelect, TaskDialog, TimeDialog } from "@/modules/projects/ui/project-dialogs";
import { TaskBoard, type BoardTask } from "@/modules/projects/ui/task-board";
import { DeleteTimeButton } from "@/modules/projects/ui/time-actions";
import { DocHeader } from "@/modules/sales/ui/doc-kit";
import { Status } from "@/components/app/status-badge";

export const metadata: Metadata = { title: "Projet" };
const TABS = ["resume", "taches", "planning", "temps"] as const;

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("project.project.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const p = await getProject(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const sp = await searchParams;
  const tab = enumParam(sp, "onglet", TABS) ?? "resume";
  const cur = ctx.company.currency;
  const manage = ctx.can("project.project.update");
  const tabs = [{ key: "resume", label: "Vue d'ensemble" }, { key: "taches", label: "Tâches" }, { key: "planning", label: "Planning" }, { key: "temps", label: "Temps passé" }];
  const readOnly = p.status === "CANCELLED" || p.status === "DONE";

  const employees = ctx.hasModule("hr") ? await ctx.db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, userId: true }, orderBy: { lastName: "asc" } }) : [];
  const empOpts = employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` }));
  const [customers, branches, costCenters] = manage ? await Promise.all([
    ctx.hasModule("crm") ? ctx.db.customer.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
    ctx.db.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.costCenter.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]) : [[], [], []];

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Projets", href: "/app/projects" }, { label: p.code }]}
        title={p.name}
        badges={<Status value={p.status} />}
        subtitle={<>{p.customer ? <>Pour <Link href={`/app/crm/clients/${p.customer.id}`} className="text-foreground hover:text-brand">{p.customer.name}</Link></> : "Projet interne"}{p.manager ? ` · chef de projet ${p.manager.firstName} ${p.manager.lastName}` : ""} · {fmtDate(p.startDate)} → {fmtDate(p.endDate)}</>}
        actions={manage ? <>
          <ProjectStatusSelect id={p.id} status={p.status} />
          <ProjectFormDialog customers={customers} employees={empOpts} branches={branches} costCenters={costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` }))}
            project={{ id: p.id, name: p.name, description: p.description ?? "", customerId: p.customerId ?? "", managerId: p.managerId ?? "", status: p.status, startDate: toInputDate(p.startDate), endDate: toInputDate(p.endDate), budget: num(p.budget), billRate: num(p.billRate), branchId: p.branchId ?? "", costCenterId: p.costCenterId ?? "" }} />
        </> : undefined}
      />
      {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
      <QueryTabs tabs={tabs} current={tab} basePath={`/app/projects/projets/${id}`} label="Sections du projet" />

      {tab === "resume" && <Summary ctx={ctx} projectId={id} cur={cur} canInvoice={manage && ctx.hasModule("sales") && ctx.can("finance.invoice.create")} hasCustomer={Boolean(p.customerId)} />}
      {tab === "taches" && <TasksTab ctx={ctx} projectId={id} employees={empOpts} manage={manage} readOnly={readOnly} userEmployees={employees} />}
      {tab === "planning" && <PlanningTab ctx={ctx} projectId={id} />}
      {tab === "temps" && <TimeTab ctx={ctx} projectId={id} employees={empOpts} readOnly={p.status !== "ACTIVE" && p.status !== "PLANNED"} />}
      {tab === "resume" && <EntityDocuments ctx={ctx} type="project" id={id} />}
    </div>
  );
}

type PageCtx = Awaited<ReturnType<typeof requirePagePermission>>;

async function Summary({ ctx, projectId, cur, canInvoice, hasCustomer }: { ctx: PageCtx; projectId: string; cur: string; canInvoice: boolean; hasCustomer: boolean }) {
  const s = await projectSummary(ctx, projectId);
  const m = (n: { toNumber(): number }) => formatMoney(n.toNumber(), cur);
  const over = s.budgetUsedPct !== null && s.budgetUsedPct > 100;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Avancement" value={s.tasks.total ? `${Math.round((s.tasks.done / s.tasks.total) * 100)} %` : "—"} hint={`${s.tasks.done} / ${s.tasks.total} tâches terminées`} />
        <Kpi label="Temps passé" value={`${s.hours.toNumber()} h`} hint={`${s.billableHours.toNumber()} h facturables · ${s.billedHours.toNumber()} h facturées`} />
        <Kpi label="Coûts totaux" value={m(s.totalCost)} hint={s.budgetUsedPct === null ? "Aucun budget défini" : `${s.budgetUsedPct} % du budget de ${m(s.budget)}`} tone={over ? "danger" : undefined} />
        <Kpi label="Marge" value={m(s.margin)} hint={`Facturé ${m(s.revenue)}`} tone={s.margin.lt(0) ? "danger" : undefined} />
      </div>
      {s.budgetUsedPct !== null && (
        <div className="space-y-1"><div className="h-2 rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, s.budgetUsedPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Consommation du budget"><div className="h-full rounded-full" style={{ width: `${Math.min(100, s.budgetUsedPct)}%`, background: over ? "var(--destructive)" : "var(--viz-1)" }} /></div></div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Détail des coûts</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Main-d'œuvre (temps × coût horaire)" value={m(s.laborCost)} />
            <Row label="Dépenses payées rattachées" value={m(s.expensesCost)} />
            <Row label="Achats fournisseurs validés (HT)" value={m(s.billsCost)} />
            <div className="border-t pt-2"><Row label="Total" value={m(s.totalCost)} bold /></div>
            <p className="text-xs text-muted-foreground">Seules les sources que vous avez le droit de consulter sont comptées.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Facturation</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Facturé (HT, factures émises)" value={m(s.revenue)} />
            <Row label="Temps facturable restant à facturer" value={m(s.toBill)} bold />
            {canInvoice && (
              <div className="pt-2">
                <ActionButton action={invoiceTimeAction} input={{ projectId }} label="Facturer le temps" icon={<FileText className="size-4" />} variant="outline" disabled={!hasCustomer || s.toBill.lte(0)} success="Brouillon de facture créé" redirectToNew="/app/sales/factures"
                  confirm={{ title: "Facturer le temps passé ?", description: "Un brouillon de facture est créé avec le temps facturable non encore facturé, regroupé par salarié. Vous pourrez l'ajuster avant de l'émettre.", confirmLabel: "Créer le brouillon" }} />
                {!hasCustomer && <p className="mt-2 text-xs text-muted-foreground">Rattachez un client au projet pour pouvoir facturer son temps.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function TasksTab({ ctx, projectId, employees, manage, readOnly, userEmployees }: { ctx: PageCtx; projectId: string; employees: { id: string; name: string }[]; manage: boolean; readOnly: boolean; userEmployees: { id: string; userId: string | null }[] }) {
  const tasks = await listTasks(ctx, projectId);
  const myId = userEmployees.find((e) => e.userId === ctx.user.id)?.id;
  const today = new Date();
  const items: BoardTask[] = tasks.map((t) => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : null, dueDate: t.dueDate ? fmtDate(t.dueDate) : null, overdue: Boolean(t.dueDate && t.dueDate < today),
    estimateHours: num(t.estimateHours), dependsOn: t.dependsOn?.title ?? null, canMove: ctx.can("project.task.manage") && (manage || t.assigneeId === myId),
    init: { id: t.id, projectId, title: t.title, description: t.description ?? "", status: t.status, priority: t.priority, assigneeId: t.assigneeId ?? "", startDate: toInputDate(t.startDate), dueDate: toInputDate(t.dueDate), estimateHours: num(t.estimateHours), dependsOnId: t.dependsOnId ?? "" },
  }));
  return (
    <div className="space-y-4">
      {manage && !readOnly && <div className="flex justify-end"><TaskDialog projectId={projectId} employees={employees} tasks={items.map((t) => ({ id: t.id, name: t.title }))} /></div>}
      {readOnly && <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">Projet clôturé : la planification est figée. Rouvrez-le pour la modifier.</p>}
      <TaskBoard tasks={items} projectId={projectId} employees={employees} canEdit={manage} readOnly={readOnly} />
    </div>
  );
}

async function PlanningTab({ ctx, projectId }: { ctx: PageCtx; projectId: string }) {
  const tasks = await listTasks(ctx, projectId);
  const dated: GanttTask[] = tasks.filter((t) => t.startDate || t.dueDate).map((t) => {
    const start = t.startDate ?? t.dueDate!, end = t.dueDate ?? t.startDate!;
    return { id: t.id, title: t.title, status: t.status, assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : null, start: start <= end ? start : end, end: end >= start ? end : start, dependsOn: t.dependsOn?.title ?? null };
  }).sort((a, b) => a.start.getTime() - b.start.getTime());
  return <Gantt tasks={dated} today={new Date()} />;
}

async function TimeTab({ ctx, projectId, employees, readOnly }: { ctx: PageCtx; projectId: string; employees: { id: string; name: string }[]; readOnly: boolean }) {
  const { rows, hours } = await listTime(ctx, { projectId, skip: 0, take: 100 });
  const me = await myEmployee(ctx);
  const tasks = (await listTasks(ctx, projectId)).map((t) => ({ id: t.id, name: t.title, projectId }));
  const manageTime = ctx.can("project.time.manage");
  const choices = manageTime ? employees : me ? [{ id: me.id, name: `${me.lastName} ${me.firstName}` }] : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted-foreground">{manageTime ? "Temps de toute l'équipe sur ce projet" : "Votre temps sur ce projet"} — total <span className="font-medium text-foreground">{hours.toNumber()} h</span></p>
        {!readOnly && choices.length > 0 && <TimeDialog projects={[{ id: projectId, name: "" }]} defaultProjectId={projectId} employees={choices} tasks={tasks} defaultEmployeeId={me?.id ?? choices[0]?.id} fixedEmployee={!manageTime} />}
      </div>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Salarié</TableHead><TableHead className="hidden sm:table-cell">Tâche</TableHead><TableHead className="text-right">Heures</TableHead><TableHead>Facturation</TableHead><TableHead className="w-24"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Aucun temps saisi.</TableCell></TableRow>}
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(t.date)}</TableCell>
                <TableCell className="text-sm">{t.employee.lastName} {t.employee.firstName}{t.description && <span className="block text-xs text-muted-foreground">{t.description}</span>}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{t.task?.title ?? "—"}</TableCell>
                <TableCell className="text-right text-sm tabular">{num(t.hours)}</TableCell>
                <TableCell className="text-sm">{t.invoiceId ? <Link href={`/app/sales/factures/${t.invoiceId}`} className="text-brand hover:underline">Facturé</Link> : t.billable ? "À facturer" : "Non facturable"}</TableCell>
                <TableCell>{!t.invoiceId && <DeleteTimeButton id={t.id} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => <div className={`flex justify-between gap-4 ${bold ? "font-semibold" : ""}`}><span className={bold ? "" : "text-muted-foreground"}>{label}</span><span className="tabular">{value}</span></div>;
function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" }) {
  return <Card><CardContent className="space-y-1 p-5"><p className="text-sm text-muted-foreground">{label}</p><p className={`truncate text-xl font-semibold tracking-tight tabular ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>{hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}</CardContent></Card>;
}
