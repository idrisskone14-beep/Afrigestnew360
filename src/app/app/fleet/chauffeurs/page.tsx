import type { Metadata } from "next";
import { Users } from "lucide-react";
import { forbidden } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate, isPast } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { archiveDriverAction } from "@/modules/fleet/actions";
import { fleetOptions } from "@/modules/fleet/lists";
import { listDrivers } from "@/modules/fleet/service";
import { DriverDialog } from "@/modules/fleet/ui/fleet-dialogs";

export const metadata: Metadata = { title: "Chauffeurs" };

export default async function DriversPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.vehicle.read") && !ctx.can("fleet.driver.manage")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["ACTIVE", "SUSPENDED", "LEFT"] as const);
  const { rows, total } = await listDrivers(ctx, { q: lp.q, status, skip: lp.skip, take: lp.take });
  const manage = ctx.can("fleet.driver.manage");
  const opt = manage ? await fleetOptions(ctx) : null;

  return (
    <>
      <ListToolbar placeholder="Nom du chauffeur…" filters={[{ name: "statut", label: "Statut", options: [{ value: "ACTIVE", label: "Actifs" }, { value: "SUSPENDED", label: "Suspendus" }, { value: "LEFT", label: "Partis" }] }]}>
        {manage && opt && <DriverDialog employees={opt.employees} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Users className="size-8" />} title="Aucun chauffeur" description={manage ? "Ajoutez vos chauffeurs, salariés ou prestataires." : undefined} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Chauffeur</TableHead><TableHead className="hidden sm:table-cell">Téléphone</TableHead>{manage && <TableHead className="hidden md:table-cell">Permis</TableHead>}<TableHead>Statut</TableHead>{manage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
            <TableBody>
              {rows.map((dr) => (
                <TableRow key={dr.id}>
                  <TableCell className="text-sm font-medium">{dr.fullName}{dr.employeeId && <div className="text-xs font-normal text-muted-foreground">Salarié</div>}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{dr.phone ?? "—"}</TableCell>
                  {manage && <TableCell className="hidden text-sm md:table-cell">{dr.licenseNumber ?? "—"}{dr.licenseCategory ? ` (${dr.licenseCategory})` : ""} {dr.licenseExpiry && <Badge variant={isPast(dr.licenseExpiry) ? "destructive" : "outline"}>{isPast(dr.licenseExpiry) ? "expiré" : "jusqu'au"} {fmtDate(dr.licenseExpiry)}</Badge>}</TableCell>}
                  <TableCell><Status value={dr.status} /></TableCell>
                  {manage && <TableCell className="text-right"><DriverDialog driver={dr} employees={opt?.employees ?? []} /><ActionButton action={archiveDriverAction} input={{ id: dr.id }} variant="ghost" size="icon" label="" ariaLabel={`Retirer ${dr.fullName}`} icon={<Trash2 className="size-4" />} success="Chauffeur retiré" confirm={{ title: `Retirer ${dr.fullName} ?`, description: "Ses affectations en cours sont terminées ; l'historique est conservé.", confirmLabel: "Retirer" }} /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/fleet/chauffeurs" searchParams={sp} />
    </>
  );
}
