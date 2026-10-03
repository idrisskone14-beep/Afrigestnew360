import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { platformDb } from "@/core/db/client";
import { countryName } from "@/lib/reference-data";
import { listCompanies } from "@/modules/platform/companies";
import { CompaniesToolbar } from "./companies-toolbar";
import { CreateCompanyDialog } from "./create-company-dialog";

export const metadata: Metadata = { title: "Entreprises" };

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
const SUB_LABEL: Record<string, string> = { TRIALING: "Essai", ACTIVE: "Actif", PAST_DUE: "Impayé", CANCELED: "Résilié" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string; page?: string }> }) {
  const sp = await searchParams;
  const status = sp.statut === "ACTIVE" || sp.statut === "SUSPENDED" ? sp.statut : undefined;
  const page = Number(sp.page) || 1;
  const [{ rows, total, pages, page: current }, plans] = await Promise.all([
    listCompanies({ q: sp.q?.trim() || undefined, status, page }),
    platformDb.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
  ]);
  const href = (p: number) => `/super-admin/entreprises?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(status ? { statut: status } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Entreprises" description={`${total} entreprise${total > 1 ? "s" : ""}`} actions={<CreateCompanyDialog plans={plans} />} />
      <CompaniesToolbar q={sp.q ?? ""} status={status ?? ""} />
      {rows.length === 0 ? (
        <EmptyState icon={<Building2 className="size-8" />} title="Aucune entreprise" description="Modifiez vos filtres ou créez une entreprise." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entreprise</TableHead>
                <TableHead className="hidden md:table-cell">Pays</TableHead>
                <TableHead>Offre</TableHead>
                <TableHead className="hidden sm:table-cell">Membres</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden lg:table-cell">Créée le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/super-admin/entreprises/${c.id}`} className="block min-w-0 hover:text-brand">
                      <span className="block truncate text-sm font-medium">{c.tradeName ?? c.legalName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{c.legalName}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{countryName(c.country)}</TableCell>
                  <TableCell className="text-sm">
                    {c.subscription?.plan.name ?? "—"}
                    {c.subscription && <span className="ml-1.5 text-xs text-muted-foreground">{SUB_LABEL[c.subscription.status]}</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm tabular sm:table-cell">{c._count.memberships}</TableCell>
                  <TableCell><Badge variant={c.status === "ACTIVE" ? "secondary" : "destructive"}>{c.status === "ACTIVE" ? "Active" : "Suspendue"}</Badge></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{dateFmt.format(c.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {current} sur {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild disabled={current <= 1}><Link href={href(Math.max(1, current - 1))} aria-disabled={current <= 1}><ChevronLeft className="size-4" /> Précédente</Link></Button>
            <Button variant="outline" size="sm" asChild disabled={current >= pages}><Link href={href(Math.min(pages, current + 1))} aria-disabled={current >= pages}>Suivante <ChevronRight className="size-4" /></Link></Button>
          </div>
        </nav>
      )}
    </>
  );
}
