import type { Metadata } from "next";
import Link from "next/link";
import { Wrench } from "lucide-react";
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
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { cancelMaintenanceAction } from "@/modules/fleet/actions";
import { fleetOptions } from "@/modules/fleet/lists";
import { listMaintenance } from "@/modules/fleet/operations";
import { MAINTENANCE_TYPES } from "@/modules/fleet/schemas";
import { CompleteMaintenanceDialog, MaintenanceDialog } from "@/modules/fleet/ui/fleet-dialogs";

export const metadata: Metadata = { title: "Entretiens" };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.vehicle.read") && !ctx.can("fleet.maintenance.manage")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["PLANNED", "DONE", "CANCELLED"] as const);
  const { rows, total } = await listMaintenance(ctx, { status, skip: lp.skip, take: lp.take });
  const opt = await fleetOptions(ctx);
  const manage = ctx.can("fleet.maintenance.manage");

  return (
    <>
      <ListToolbar placeholder="Rechercher…" filters={[{ name: "statut", label: "Statut", options: [{ value: "PLANNED", label: "Planifiés" }, { value: "DONE", label: "Réalisés" }, { value: "CANCELLED", label: "Annulés" }] }]}>
        {manage && <MaintenanceDialog vehicles={opt.vehicles} suppliers={opt.suppliers} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Wrench className="size-8" />} title="Aucun entretien" description={manage ? "Planifiez ou enregistrez un entretien : la prochaine échéance (date ou kilométrage) déclenche une alerte." : undefined} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Véhicule</TableHead><TableHead>Entretien</TableHead><TableHead className="text-right">Coût</TableHead><TableHead>Statut</TableHead>{manage && <TableHead className="w-44"><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDate(m.date)}</TableCell>
                  <TableCell className="text-sm"><Link href={`/app/fleet/vehicules/${m.vehicle.id}?onglet=entretiens`} className="font-medium hover:text-brand">{m.vehicle.plate}</Link></TableCell>
                  <TableCell className="text-sm">{m.description}<div className="text-xs text-muted-foreground">{MAINTENANCE_TYPES.find((t) => t.value === m.type)?.label}</div></TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(d(m.cost).toNumber(), ctx.company.currency)}</TableCell>
                  <TableCell><Status value={m.status === "CANCELLED" ? "CANCELLED" : m.status === "DONE" ? "DONE" : "PLANNED"} /></TableCell>
                  {manage && <TableCell className="text-right">{m.status === "PLANNED" && <><CompleteMaintenanceDialog id={m.id} /><ActionButton action={cancelMaintenanceAction} input={{ id: m.id }} variant="ghost" size="sm" label="Annuler" success="Entretien annulé" /></>}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/fleet/entretiens" searchParams={sp} />
    </>
  );
}
