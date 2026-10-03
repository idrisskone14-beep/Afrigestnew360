import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KanbanSquare } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listProjects } from "@/modules/projects/service";
import { ProjectFormDialog } from "@/modules/projects/ui/project-dialogs";

export const metadata: Metadata = { title: "Projets" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("projects");
  if (!ctx.can("project.project.read")) redirect("/app/projects/mes-taches");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["PLANNED", "ACTIVE", "ON_HOLD", "DONE", "CANCELLED"] as const);
  const { rows, total } = await listProjects(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });
  const create = ctx.can("project.project.create");
  const [customers, employees, branches, costCenters] = create ? await Promise.all([
    ctx.hasModule("crm") ? ctx.db.customer.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
    ctx.hasModule("hr") ? ctx.db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
    ctx.db.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.costCenter.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]) : [[], [], [], []];
  const cur = ctx.company.currency;

  return (
    <>
      <ListToolbar placeholder="Nom ou code…" filters={[{ name: "statut", label: "Statut", options: [{ value: "PLANNED", label: "Planifiés" }, { value: "ACTIVE", label: "En cours" }, { value: "ON_HOLD", label: "En pause" }, { value: "DONE", label: "Terminés" }, { value: "CANCELLED", label: "Annulés" }] }]}>
        {create && <ProjectFormDialog customers={customers} employees={employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` }))} branches={branches} costCenters={costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` }))} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<KanbanSquare className="size-8" />} title="Aucun projet" description="Créez un projet pour planifier ses tâches, suivre le temps passé et mesurer sa rentabilité." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Projet</TableHead><TableHead className="hidden md:table-cell">Client</TableHead><TableHead className="hidden lg:table-cell">Chef de projet</TableHead><TableHead className="hidden sm:table-cell">Échéance</TableHead><TableHead className="hidden text-right lg:table-cell">Budget</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><Link href={`/app/projects/projets/${p.id}`} className="block hover:text-brand"><span className="block text-sm font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.code} · {p._count.tasks} tâche{p._count.tasks > 1 ? "s" : ""}</span></Link></TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{p.customer?.name ?? "Interne"}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{p.manager ? `${p.manager.firstName} ${p.manager.lastName}` : "—"}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(p.endDate)}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular lg:table-cell">{num(p.budget) ? formatMoney(num(p.budget), cur) : "—"}</TableCell>
                  <TableCell><Status value={p.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/projects" searchParams={sp} />
    </>
  );
}
