import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listLeads } from "@/modules/crm/service";
import { LeadActions, LeadFormDialog } from "@/modules/crm/ui/lead-ui";

export const metadata: Metadata = { title: "Prospects" };

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "LOST", "CONVERTED"] as const;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("crm.lead.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const { rows, total } = await listLeads(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });
  const can = { update: ctx.can("crm.lead.update"), delete: ctx.can("crm.lead.delete"), convert: ctx.can("crm.lead.update") && ctx.can("crm.customer.create") };

  return (
    <>
      <ListToolbar placeholder="Rechercher un prospect…" filters={[{ name: "statut", label: "Statut", options: [{ value: "NEW", label: "Nouveaux" }, { value: "CONTACTED", label: "Contactés" }, { value: "QUALIFIED", label: "Qualifiés" }, { value: "LOST", label: "Perdus" }, { value: "CONVERTED", label: "Convertis" }] }]}>
        {ctx.can("crm.lead.create") && <LeadFormDialog />}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<UserPlus className="size-8" />} title="Aucun prospect" description="Ajoutez vos prospects pour suivre leur qualification, puis convertissez-les en clients." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Prospect</TableHead><TableHead className="hidden md:table-cell">Contact</TableHead><TableHead className="hidden lg:table-cell">Source</TableHead><TableHead className="hidden sm:table-cell text-right">Valeur</TableHead><TableHead>Statut</TableHead><TableHead className="hidden lg:table-cell">Créé le</TableHead><TableHead className="w-10"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><span className="block truncate text-sm font-medium">{l.name}</span><span className="block text-xs text-muted-foreground">{l.companyName ?? ""}</span></TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{l.email ?? "—"}<span className="block text-xs text-muted-foreground">{l.phone ?? ""}</span></TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{l.source ?? "—"}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular sm:table-cell">{l.estimatedValue ? formatMoney(num(l.estimatedValue), ctx.company.currency) : "—"}</TableCell>
                  <TableCell><Status value={l.status} /></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{fmtDate(l.createdAt)}</TableCell>
                  <TableCell>
                    <LeadActions can={can} lead={{ id: l.id, name: l.name, companyName: l.companyName, email: l.email, phone: l.phone, source: l.source, status: l.status, estimatedValue: l.estimatedValue ? num(l.estimatedValue) : null, notes: l.notes }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/crm/prospects" searchParams={sp} />
    </>
  );
}
