import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { forbidden } from "next/navigation";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { ListToolbar } from "@/components/app/list-kit";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { listTime, myEmployee } from "@/modules/projects/service";
import { TimeDialog } from "@/modules/projects/ui/project-dialogs";
import { DeleteTimeButton } from "@/modules/projects/ui/time-actions";

export const metadata: Metadata = { title: "Temps passé" };

export default async function TimePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("projects");
  if (!ctx.can("project.time.manage") && !ctx.can("project.task.manage")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const manage = ctx.can("project.time.manage");
  const [projects, me, employees] = await Promise.all([
    ctx.db.project.findMany({ where: { deletedAt: null, status: { in: ["PLANNED", "ACTIVE"] } }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    myEmployee(ctx),
    manage && ctx.hasModule("hr") ? ctx.db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);
  const allProjects = await ctx.db.project.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } });
  const projectId = allProjects.find((p) => p.id === param(sp, "projet"))?.id;
  const { rows, total, hours } = await listTime(ctx, { projectId, skip: lp.skip, take: lp.take });
  const tasks = await ctx.db.projectTask.findMany({ where: { project: { status: { in: ["PLANNED", "ACTIVE"] } }, status: { not: "DONE" } }, select: { id: true, title: true, projectId: true }, take: 500 });
  const choices = manage ? employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` })) : me ? [{ id: me.id, name: `${me.lastName} ${me.firstName}` }] : [];

  return (
    <>
      <ListToolbar placeholder="Rechercher…" filters={[{ name: "projet", label: "Projet", options: allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })) }]}>
        {choices.length > 0 && projects.length > 0 && <TimeDialog projects={projects.map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` }))} employees={choices} tasks={tasks.map((t) => ({ id: t.id, name: t.title, projectId: t.projectId }))} defaultEmployeeId={me?.id ?? choices[0]?.id} fixedEmployee={!manage} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Clock className="size-8" />} title="Aucun temps saisi" description={me || manage ? "Saisissez le temps passé sur vos projets." : "Votre compte n'est lié à aucune fiche salarié : contactez les ressources humaines."} /> : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">{total} saisie{total > 1 ? "s" : ""} · total <span className="font-medium text-foreground">{hours.toNumber()} h</span></p>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Projet</TableHead>{manage && <TableHead>Salarié</TableHead>}<TableHead className="hidden sm:table-cell">Tâche</TableHead><TableHead className="text-right">Heures</TableHead><TableHead>Facturation</TableHead><TableHead className="w-24"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(t.date)}</TableCell>
                    <TableCell className="text-sm">{ctx.can("project.project.read") ? <Link href={`/app/projects/projets/${t.project.id}?onglet=temps`} className="hover:text-brand">{t.project.code} — {t.project.name}</Link> : `${t.project.code} — ${t.project.name}`}</TableCell>
                    {manage && <TableCell className="text-sm">{t.employee.lastName} {t.employee.firstName}</TableCell>}
                    <TableCell className="hidden text-sm sm:table-cell">{t.task?.title ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular">{num(t.hours)}</TableCell>
                    <TableCell className="text-sm">{t.invoiceId ? "Facturé" : t.billable ? "À facturer" : "Non facturable"}</TableCell>
                    <TableCell>{!t.invoiceId && <DeleteTimeButton id={t.id} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/projects/temps" searchParams={sp} />
    </>
  );
}
