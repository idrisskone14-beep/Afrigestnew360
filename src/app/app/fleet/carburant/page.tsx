import type { Metadata } from "next";
import Link from "next/link";
import { Fuel } from "lucide-react";
import { forbidden } from "next/navigation";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { d } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { fleetOptions } from "@/modules/fleet/lists";
import { listFuel } from "@/modules/fleet/operations";
import { FuelDialog } from "@/modules/fleet/ui/fleet-dialogs";

export const metadata: Metadata = { title: "Carburant" };

export default async function FuelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.vehicle.read") && !ctx.can("fleet.fuel.manage")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const opt = await fleetOptions(ctx);
  const vehicleId = opt.allVehicles.find((v) => v.id === param(sp, "vehicule"))?.id;
  const { rows, total } = await listFuel(ctx, { vehicleId, skip: lp.skip, take: lp.take });
  const manage = ctx.can("fleet.fuel.manage");

  return (
    <>
      <ListToolbar placeholder="Rechercher…" filters={[{ name: "vehicule", label: "Véhicule", options: opt.allVehicles.map((v) => ({ value: v.id, label: v.name })) }]}>
        {manage && <FuelDialog vehicles={opt.vehicles} drivers={opt.drivers} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Fuel className="size-8" />} title="Aucun plein enregistré" description={manage ? "Saisissez les pleins : kilométrage, litres et montant. La consommation est calculée entre deux pleins complets." : undefined} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Véhicule</TableHead><TableHead className="hidden sm:table-cell">Chauffeur</TableHead><TableHead className="text-right">Km</TableHead><TableHead className="text-right">Litres</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDate(r.date)}</TableCell>
                  <TableCell className="text-sm"><Link href={`/app/fleet/vehicules/${r.vehicle.id}?onglet=carburant`} className="font-medium hover:text-brand">{r.vehicle.plate}</Link>{r.station && <div className="text-xs text-muted-foreground">{r.station}</div>}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{r.driver?.fullName ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular">{r.odometer.toLocaleString("fr-FR")}</TableCell>
                  <TableCell className="text-right text-sm tabular">{d(r.liters).toNumber()}</TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(d(r.amount).toNumber(), ctx.company.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/fleet/carburant" searchParams={sp} />
    </>
  );
}
