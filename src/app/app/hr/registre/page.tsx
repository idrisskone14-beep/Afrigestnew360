import type { Metadata } from "next";
import Link from "next/link";
import { BookUser } from "lucide-react";
import { ListScope, SelectionBar } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { CONTRACT_TYPES } from "@/modules/hr/schemas";
import { staffRegister } from "@/modules/hr/staff";
import { ExportLinks } from "@/modules/hr/ui/export-links";

export const metadata: Metadata = { title: "Registre du personnel" };

export default async function StaffRegisterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("hr.employee.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["ACTIVE", "SUSPENDED", "TERMINATED"] as const);
  const departmentId = param(sp, "service");
  const departments = await ctx.db.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const { rows, total } = await staffRegister(ctx, { q: lp.q || undefined, status, departmentId: departments.find((d) => d.id === departmentId)?.id, skip: lp.skip, take: lp.take });

  return (
    <ListScope filename="registre-du-personnel">
      <ListToolbar placeholder="Nom, matricule, poste…" filters={[
        { name: "statut", label: "Situation", options: [{ value: "ACTIVE", label: "En activité" }, { value: "SUSPENDED", label: "Suspendus" }, { value: "TERMINATED", label: "Sortis" }] },
        { name: "service", label: "Service", options: departments.map((d) => ({ value: d.id, label: d.name })) },
      ]}>
        <ExportLinks kind="hr-registre-personnel" params={{ q: lp.q || undefined, statut: status }} />
      </ListToolbar>
      <SelectionBar />
      <p className="mb-3 text-xs text-muted-foreground">Vue de gestion tirée des fiches salariés et des contrats (aucune donnée dupliquée ; ni salaire ni pièce d&apos;identité). Elle ne remplace pas le registre légal de l&apos;employeur.</p>
      {rows.length === 0 ? <EmptyState icon={<BookUser className="size-8" />} title="Aucun salarié" description="Les salariés enregistrés apparaissent ici." /> : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Matricule</TableHead><TableHead>Nom et prénoms</TableHead><TableHead>Service / poste</TableHead><TableHead>Statut professionnel</TableHead><TableHead>Contrat</TableHead><TableHead>Embauche</TableHead><TableHead>Responsable</TableHead><TableHead>Situation</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm tabular">{r.number}</TableCell>
                  <TableCell className="text-sm font-medium"><Link href={`/app/hr/salaries/${r.id}`} className="hover:text-brand">{r.lastName} {r.firstName}</Link><span className="block text-xs font-normal text-muted-foreground">{[r.phone, r.email].filter(Boolean).join(" · ")}</span></TableCell>
                  <TableCell className="text-sm">{r.jobTitle ?? "—"}<span className="block text-xs text-muted-foreground">{[r.department?.name, r.branch?.name].filter(Boolean).join(" · ")}</span></TableCell>
                  <TableCell className="text-sm">{r.professionalCategory ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.contract ? CONTRACT_TYPES.find((t) => t.value === r.contract!.type)?.label : "—"}{r.contract?.endDate && <span className="block text-xs text-muted-foreground">jusqu&apos;au {fmtDate(r.contract.endDate)}</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.hireDate)}</TableCell>
                  <TableCell className="text-sm">{r.manager ? `${r.manager.lastName} ${r.manager.firstName}` : "—"}</TableCell>
                  <TableCell><Status value={r.status} />{r.endDate && <span className="block text-xs text-muted-foreground">{fmtDate(r.endDate)}{r.terminationReason ? ` — ${r.terminationReason}` : ""}</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/registre" searchParams={sp} />
    </ListScope>
  );
}
