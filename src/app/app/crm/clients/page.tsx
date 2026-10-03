import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { listCustomers } from "@/modules/crm/service";
import { CustomerFormDialog } from "@/modules/crm/ui/customer-form";

export const metadata: Metadata = { title: "Clients" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("crm.customer.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const statut = enumParam(sp, "statut", ["actifs", "inactifs"] as const);
  const { rows, total } = await listCustomers(ctx, { q: lp.q, skip: lp.skip, take: lp.take, active: statut === undefined ? undefined : statut === "actifs" });

  return (
    <>
      <ListToolbar placeholder="Rechercher un client…" filters={[{ name: "statut", label: "Statut", options: [{ value: "actifs", label: "Actifs" }, { value: "inactifs", label: "Inactifs" }] }]}>
        {ctx.can("crm.customer.create") && <CustomerFormDialog defaultCountry={ctx.company.country} />}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<Users className="size-8" />} title={lp.q ? "Aucun client trouvé" : "Aucun client pour le moment"} description={lp.q ? "Essayez une autre recherche." : "Créez votre premier client ou convertissez un prospect."} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden lg:table-cell">Ville</TableHead>
                <TableHead className="hidden sm:table-cell">Délai</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/app/crm/clients/${c.id}`} className="block min-w-0 hover:text-brand">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">{c.code}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell"><span className="block truncate">{c.email ?? "—"}</span><span className="block text-xs text-muted-foreground">{c.phone ?? ""}</span></TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{c.city ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm tabular sm:table-cell">{c.paymentTermsDays} j</TableCell>
                  <TableCell><StatusBadge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "Actif" : "Inactif"}</StatusBadge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/crm/clients" searchParams={sp} />
    </>
  );
}
