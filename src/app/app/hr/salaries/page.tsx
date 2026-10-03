import type { Metadata } from "next";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { canSeePay, listEmployees } from "@/modules/hr/employees";
import { EmployeeFormDialog } from "@/modules/hr/ui/employee-dialogs";

export const metadata: Metadata = { title: "Salariés" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("hr.employee.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["ACTIVE", "SUSPENDED", "TERMINATED"] as const);
  const [departments, branches] = await Promise.all([
    ctx.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const departmentId = departments.find((d) => d.id === param(sp, "departement"))?.id;
  const branchId = branches.find((b) => b.id === param(sp, "agence"))?.id;
  const { rows, total } = await listEmployees(ctx, { q: lp.q, status, departmentId, branchId, skip: lp.skip, take: lp.take });
  const pay = canSeePay(ctx);
  const create = ctx.can("hr.employee.create");
  const [managers, members] = create ? await Promise.all([
    ctx.db.employee.findMany({ where: { deletedAt: null, status: { not: "TERMINATED" } }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }),
    ctx.db.companyMembership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, user: { select: { name: true, email: true } } } }),
  ]) : [[], []];

  return (
    <>
      <ListToolbar placeholder="Nom, matricule, poste…" filters={[
        { name: "statut", label: "Statut", options: [{ value: "ACTIVE", label: "En activité" }, { value: "SUSPENDED", label: "Suspendus" }, { value: "TERMINATED", label: "Sortis" }] },
        { name: "departement", label: "Département", options: departments.map((d) => ({ value: d.id, label: d.name })) },
        { name: "agence", label: "Agence", options: branches.map((b) => ({ value: b.id, label: b.name })) },
      ]}>
        {create && <EmployeeFormDialog departments={departments} branches={branches} managers={managers.map((m) => ({ id: m.id, name: `${m.lastName} ${m.firstName}` }))} users={members.map((m) => ({ id: m.userId, name: `${m.user.name} (${m.user.email})` }))} canPay={pay} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<UserRound className="size-8" />} title={lp.q ? "Aucun salarié trouvé" : "Aucun salarié pour le moment"} description="Enregistrez vos salariés pour gérer contrats, congés, présences et paie." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead className="hidden md:table-cell">Poste</TableHead><TableHead className="hidden lg:table-cell">Département</TableHead><TableHead className="hidden sm:table-cell">Embauche</TableHead>{pay && <TableHead className="hidden text-right lg:table-cell">Salaire de base</TableHead>}<TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell><Link href={`/app/hr/salaries/${e.id}`} className="block hover:text-brand"><span className="block text-sm font-medium">{e.lastName} {e.firstName}</span><span className="block text-xs text-muted-foreground">{e.number}</span></Link></TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{e.jobTitle ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{e.department?.name ?? "—"}{e.branch ? <span className="block text-xs text-muted-foreground">{e.branch.name}</span> : null}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(e.hireDate)}</TableCell>
                  {pay && <TableCell className="hidden text-right text-sm tabular lg:table-cell">{e.baseSalary ? formatMoney(num(e.baseSalary), e.currency) : "—"}</TableCell>}
                  <TableCell><Status value={e.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/salaries" searchParams={sp} />
    </>
  );
}
