import type { Metadata } from "next";
import { Route } from "lucide-react";
import { forbidden } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { d } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { cancelTripAction } from "@/modules/fleet/actions";
import { fleetOptions } from "@/modules/fleet/lists";
import { listTrips } from "@/modules/fleet/operations";
import { TRIP_STATUSES } from "@/modules/fleet/schemas";
import { FinishTripDialog, StartTripDialog, TripDialog } from "@/modules/fleet/ui/fleet-dialogs";

export const metadata: Metadata = { title: "Missions" };

export default async function TripsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.vehicle.read") && !ctx.can("fleet.trip.manage")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", TRIP_STATUSES.map((s) => s.value));
  const opt = await fleetOptions(ctx);
  const vehicleId = opt.allVehicles.find((v) => v.id === param(sp, "vehicule"))?.id;
  const { rows, total } = await listTrips(ctx, { status, vehicleId, skip: lp.skip, take: lp.take });
  const manage = ctx.can("fleet.trip.manage");

  return (
    <>
      <ListToolbar placeholder="Rechercher…" filters={[
        { name: "statut", label: "Statut", options: TRIP_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
        { name: "vehicule", label: "Véhicule", options: opt.allVehicles.map((v) => ({ value: v.id, label: v.name })) },
      ]}>
        {manage && <TripDialog vehicles={opt.vehicles} drivers={opt.drivers} customers={opt.customers} projects={opt.projects} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Route className="size-8" />} title="Aucune mission" description={manage ? "Planifiez une mission : le véhicule, le chauffeur, le permis et les assurances sont contrôlés." : undefined} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Mission</TableHead><TableHead>Trajet</TableHead><TableHead className="hidden sm:table-cell">Véhicule / chauffeur</TableHead><TableHead className="hidden text-right md:table-cell">Km</TableHead><TableHead className="hidden text-right md:table-cell">Produit</TableHead><TableHead>Statut</TableHead>{manage && <TableHead className="w-44"><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm font-medium">{t.number}<div className="text-xs font-normal text-muted-foreground">{fmtDateTime(t.plannedStart)}</div></TableCell>
                  <TableCell className="text-sm">{t.origin} → {t.destination}{t.cargo && <div className="text-xs text-muted-foreground">{t.cargo}</div>}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{t.vehicle.plate}<div className="text-xs text-muted-foreground">{t.driver.fullName}</div></TableCell>
                  <TableCell className="hidden text-right text-sm tabular md:table-cell">{t.distanceKm?.toLocaleString("fr-FR") ?? "—"}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular md:table-cell">{d(t.revenue).gt(0) ? formatMoney(d(t.revenue).toNumber(), ctx.company.currency) : "—"}</TableCell>
                  <TableCell><Status value={t.status} /></TableCell>
                  {manage && (
                    <TableCell className="text-right">
                      {t.status === "PLANNED" && <><StartTripDialog id={t.id} odometer={t.vehicle.odometer} /><TripDialog trip={{ ...t, revenue: d(t.revenue).toNumber() }} vehicles={opt.vehicles} drivers={opt.drivers} customers={opt.customers} projects={opt.projects} /></>}
                      {t.status === "IN_PROGRESS" && t.startKm !== null && <FinishTripDialog id={t.id} startKm={t.startKm} revenue={d(t.revenue).toNumber()} />}
                      {(t.status === "PLANNED" || t.status === "IN_PROGRESS") && <ActionButton action={cancelTripAction} input={{ id: t.id }} variant="ghost" size="sm" label="Annuler" success="Mission annulée" confirm={{ title: `Annuler la mission ${t.number} ?`, confirmLabel: "Annuler la mission" }} />}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/fleet/missions" searchParams={sp} />
    </>
  );
}
