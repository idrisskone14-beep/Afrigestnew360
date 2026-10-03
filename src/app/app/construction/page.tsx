import type { Metadata } from "next";
import Link from "next/link";
import { HardHat } from "lucide-react";
import { forbidden } from "next/navigation";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { d } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { SITE_STATUSES } from "@/modules/construction/schemas";
import { listSites } from "@/modules/construction/service";
import { SiteDialog } from "@/modules/construction/ui/site-dialogs";

export const metadata: Metadata = { title: "Chantiers" };

export default async function SitesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("construction");
  if (!ctx.can("construction.site.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", SITE_STATUSES.map((s) => s.value));
  const { rows, total } = await listSites(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });
  const manage = ctx.can("construction.site.manage") && ctx.hasModule("projects");
  const [customers, employees, projects] = await Promise.all([
    manage && ctx.hasModule("crm") ? ctx.db.customer.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
    manage && ctx.hasModule("hr") && ctx.can("hr.employee.read") ? ctx.db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
    ctx.db.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, budget: true } }),
  ]);
  const budget = new Map(projects.map((p) => [p.id, d(p.budget).toNumber()]));
  const customerName = new Map((await ctx.db.customer.findMany({ where: { id: { in: rows.flatMap((r) => (r.customerId ? [r.customerId] : [])) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  return (
    <>
      <ListToolbar placeholder="Code, nom, ville…" filters={[{ name: "statut", label: "Statut", options: SITE_STATUSES.map((s) => ({ value: s.value, label: s.label })) }]}>
        {manage && <SiteDialog customers={customers} employees={employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` }))} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<HardHat className="size-8" />} title="Aucun chantier" description={manage ? "Créez un chantier : un projet est créé en même temps pour suivre dépenses, temps et facturation." : undefined} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Chantier</TableHead><TableHead className="hidden md:table-cell">Client</TableHead><TableHead className="hidden sm:table-cell">Période</TableHead><TableHead className="text-right">Budget</TableHead><TableHead>Avancement</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Link href={`/app/construction/chantiers/${s.id}`} className="font-medium hover:text-brand">{s.code} — {s.name}</Link><div className="text-xs text-muted-foreground">{s.city}</div></TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{s.customerId ? customerName.get(s.customerId) ?? "—" : "—"}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{s.startDate ? fmtDate(s.startDate) : "—"} → {s.endDate ? fmtDate(s.endDate) : "…"}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(budget.get(s.projectId) ?? 0, ctx.company.currency)}</TableCell>
                  <TableCell className="w-40"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Avancement ${s.code}`}><div className="h-full bg-brand" style={{ width: `${s.progress}%` }} /></div><span className="w-9 text-right text-xs tabular">{s.progress} %</span></div></TableCell>
                  <TableCell><Status value={s.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/construction" searchParams={sp} />
    </>
  );
}
