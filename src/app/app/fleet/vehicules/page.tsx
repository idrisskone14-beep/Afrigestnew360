import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { forbidden } from "next/navigation";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { fleetOptions } from "@/modules/fleet/lists";
import { VEHICLE_STATUSES, VEHICLE_TYPES } from "@/modules/fleet/schemas";
import { listVehicles } from "@/modules/fleet/service";
import { VehicleDialog } from "@/modules/fleet/ui/fleet-dialogs";

export const metadata: Metadata = { title: "Véhicules" };

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.vehicle.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", VEHICLE_STATUSES.map((s) => s.value));
  const type = enumParam(sp, "type", VEHICLE_TYPES.map((t) => t.value));
  const { rows, total } = await listVehicles(ctx, { q: lp.q, status, type, skip: lp.skip, take: lp.take });
  const manage = ctx.can("fleet.vehicle.manage");
  const opt = manage ? await fleetOptions(ctx) : null;
  const typeLabel = (v: string) => VEHICLE_TYPES.find((t) => t.value === v)?.label ?? v;

  return (
    <>
      <ListToolbar placeholder="Immatriculation, marque…" filters={[
        { name: "statut", label: "Statut", options: VEHICLE_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
        { name: "type", label: "Type", options: VEHICLE_TYPES.map((t) => ({ value: t.value, label: t.label })) },
      ]}>
        {manage && opt && <VehicleDialog branches={opt.branches} costCenters={opt.costCenters} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Truck className="size-8" />} title="Aucun véhicule" description={manage ? "Ajoutez votre premier véhicule pour suivre missions, carburant, entretiens et coûts." : undefined} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Immatriculation</TableHead><TableHead className="hidden sm:table-cell">Type</TableHead><TableHead className="hidden md:table-cell">Marque / modèle</TableHead><TableHead className="text-right">Kilométrage</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell><Link href={`/app/fleet/vehicules/${v.id}`} className="font-medium hover:text-brand">{v.plate}</Link>{v.name && <div className="text-xs text-muted-foreground">{v.name}</div>}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{typeLabel(v.type)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{[v.brand, v.model, v.year].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular">{v.odometer.toLocaleString("fr-FR")} km</TableCell>
                  <TableCell><Status value={v.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/fleet/vehicules" searchParams={sp} />
    </>
  );
}
