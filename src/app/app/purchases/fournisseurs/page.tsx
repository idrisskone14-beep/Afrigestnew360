import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { listSuppliers } from "@/modules/purchasing/suppliers";
import { SupplierFormDialog } from "@/modules/purchasing/ui/supplier-form";

export const metadata: Metadata = { title: "Fournisseurs" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("purchases.supplier.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const statut = enumParam(sp, "statut", ["actifs", "inactifs"] as const);
  const { rows, total } = await listSuppliers(ctx, { q: lp.q, skip: lp.skip, take: lp.take, active: statut === undefined ? undefined : statut === "actifs" });

  return (
    <>
      <ListToolbar placeholder="Rechercher un fournisseur…" filters={[{ name: "statut", label: "Statut", options: [{ value: "actifs", label: "Actifs" }, { value: "inactifs", label: "Inactifs" }] }]}>
        {ctx.can("purchases.supplier.create") && <SupplierFormDialog defaultCountry={ctx.company.country} />}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<Truck className="size-8" />} title={lp.q ? "Aucun fournisseur trouvé" : "Aucun fournisseur pour le moment"} description={lp.q ? "Essayez une autre recherche." : "Créez votre premier fournisseur pour passer des commandes."} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Fournisseur</TableHead><TableHead className="hidden md:table-cell">Contact</TableHead><TableHead className="hidden lg:table-cell">Ville</TableHead><TableHead className="hidden sm:table-cell">Délai</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/app/purchases/fournisseurs/${s.id}`} className="block min-w-0 hover:text-brand">
                      <span className="block truncate text-sm font-medium">{s.name}</span>
                      <span className="block text-xs text-muted-foreground">{s.code}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell"><span className="block truncate">{s.email ?? "—"}</span><span className="block text-xs text-muted-foreground">{s.phone ?? ""}</span></TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{s.city ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm tabular sm:table-cell">{s.paymentTermsDays} j</TableCell>
                  <TableCell><StatusBadge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? "Actif" : "Inactif"}</StatusBadge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/purchases/fournisseurs" searchParams={sp} />
    </>
  );
}
