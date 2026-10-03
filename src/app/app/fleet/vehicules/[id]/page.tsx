import type { Metadata } from "next";
import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { z } from "zod";
import { Trash2, Archive } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { QueryTabs } from "@/components/app/query-tabs";
import { Status } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { d } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { enumParam, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { archiveVehicleAction, deleteComplianceAction, deleteFuelAction, endAssignmentAction, createExpenseFromCostAction, deleteMaintenanceAction, cancelMaintenanceAction } from "@/modules/fleet/actions";
import { vehicleEconomics } from "@/modules/fleet/costs";
import { fleetOptions } from "@/modules/fleet/lists";
import { fuelStats } from "@/modules/fleet/operations";
import { COMPLIANCE_KINDS, FUEL_TYPES, MAINTENANCE_TYPES, VEHICLE_TYPES } from "@/modules/fleet/schemas";
import { complianceStatus, getVehicle, listAssignments, listCompliance } from "@/modules/fleet/service";
import { AssignDialog, CompleteMaintenanceDialog, ComplianceDialog, FuelDialog, MaintenanceDialog, VehicleDialog } from "@/modules/fleet/ui/fleet-dialogs";
import { Info } from "@/components/app/info-item";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";

export const metadata: Metadata = { title: "Véhicule" };
const TABS = ["resume", "missions", "carburant", "entretiens", "conformite", "contraventions", "documents", "couts"] as const;
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;
const STATE: Record<string, { text: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  OK: { text: "Valide", variant: "default" }, EXPIRING: { text: "Bientôt expirée", variant: "secondary" }, EXPIRED: { text: "Expirée", variant: "destructive" }, MISSING: { text: "Non renseignée", variant: "outline" },
};

export default async function VehicleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.vehicle.read")) forbidden();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const v = await getVehicle(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const sp = await searchParams;
  const canFine = ctx.can("fleet.fine.read");
  const tabs = [
    { key: "resume", label: "Résumé" }, { key: "missions", label: "Missions" }, { key: "carburant", label: "Carburant" }, { key: "entretiens", label: "Entretiens" }, { key: "conformite", label: "Assurance et visite" },
    ...(canFine ? [{ key: "contraventions", label: "Contraventions" }] : []), ...(ctx.hasModule("documents") && ctx.can("documents.document.read") ? [{ key: "documents", label: "Documents" }] : []), { key: "couts", label: "Coûts et rentabilité" },
  ];
  const tab = enumParam(sp, "onglet", TABS) ?? "resume";
  const cur = ctx.company.currency;
  const base = `/app/fleet/vehicules/${id}`;
  const manage = ctx.can("fleet.vehicle.manage");
  const opt = await fleetOptions(ctx);
  const money = (n: unknown) => formatMoney(d(n as number).toNumber(), cur);
  const compliance = await listCompliance(ctx, id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/fleet/vehicules" className="hover:text-foreground">Véhicules</Link> / {v.plate}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{v.plate} <Status value={v.status} /></h2>
          <p className="text-sm text-muted-foreground">{[label(VEHICLE_TYPES, v.type), v.brand, v.model, v.year].filter(Boolean).join(" · ")} — {v.odometer.toLocaleString("fr-FR")} km</p>
        </div>
        {manage && (
          <div className="flex gap-2">
            <VehicleDialog vehicle={{ ...v, acquisitionCost: d(v.acquisitionCost).toNumber() }} branches={opt.branches} costCenters={opt.costCenters} />
            <ActionButton action={archiveVehicleAction} input={{ id }} variant="outline" size="sm" label="Retirer" icon={<Archive className="size-4" />} redirectTo="/app/fleet/vehicules" success="Véhicule retiré" confirm={{ title: `Retirer ${v.plate} de la flotte ?`, description: "L'historique (missions, carburant, entretiens, PV) est conservé.", confirmLabel: "Retirer" }} />
          </div>
        )}
      </div>

      <QueryTabs tabs={tabs} current={tab} basePath={base} label="Sections du véhicule" />

      {tab === "resume" && <Resume ctx={ctx} v={v} compliance={compliance} manage={manage} drivers={opt.drivers} />}
      {tab === "missions" && <Missions ctx={ctx} vehicleId={id} />}
      {tab === "carburant" && <Fuel ctx={ctx} vehicleId={id} vehicles={opt.vehicles} drivers={opt.drivers} />}
      {tab === "entretiens" && <Maintenance ctx={ctx} vehicleId={id} vehicles={opt.vehicles} suppliers={opt.suppliers} />}
      {tab === "conformite" && (
        <Card className="overflow-hidden p-0">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Assurance, visite technique, documents</CardTitle>{manage && <ComplianceDialog vehicleId={id} />}</CardHeader>
          {compliance.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun document enregistré. Une assurance ou une visite technique expirée bloque le départ en mission des véhicules routiers.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Document</TableHead><TableHead className="hidden sm:table-cell">Référence</TableHead><TableHead>Échéance</TableHead><TableHead className="hidden sm:table-cell text-right">Coût</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {compliance.map((c) => {
                  const latest = complianceStatus(compliance, c.kind).expiresAt?.getTime() === c.expiresAt.getTime();
                  return (
                    <TableRow key={c.id} className={latest ? "" : "opacity-60"}>
                      <TableCell className="text-sm font-medium">{label(COMPLIANCE_KINDS, c.kind)}{c.provider && <div className="text-xs font-normal text-muted-foreground">{c.provider}</div>}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{c.reference ?? "—"}</TableCell>
                      <TableCell className="text-sm">{fmtDate(c.expiresAt)} {latest && <Badge variant={STATE[complianceStatus(compliance, c.kind).state]!.variant}>{STATE[complianceStatus(compliance, c.kind).state]!.text}</Badge>}</TableCell>
                      <TableCell className="hidden text-right text-sm tabular sm:table-cell">{money(c.cost)}</TableCell>
                      <TableCell>{manage && <ActionButton action={deleteComplianceAction} input={{ id: c.id }} variant="ghost" size="icon" label="" ariaLabel="Supprimer ce document" icon={<Trash2 className="size-4" />} success="Document supprimé" confirm={{ title: "Supprimer ce document ?", confirmLabel: "Supprimer" }} />}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
      {tab === "contraventions" && canFine && <VehicleFines ctx={ctx} vehicleId={id} />}
      {tab === "documents" && <EntityDocuments ctx={ctx} type="vehicle" id={id} />}
      {tab === "couts" && <Costs ctx={ctx} vehicleId={id} sp={sp} />}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof requireModulePage>>;

async function Resume({ ctx, v, compliance, manage, drivers }: { ctx: Ctx; v: Awaited<ReturnType<typeof getVehicle>>; compliance: Awaited<ReturnType<typeof listCompliance>>; manage: boolean; drivers: { id: string; name: string }[] }) {
  const assignments = await listAssignments(ctx, v.id);
  const current = assignments.find((a) => !a.endDate);
  const ins = complianceStatus(compliance, "INSURANCE"), vt = complianceStatus(compliance, "TECHNICAL_INSPECTION");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Fiche</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3">
        <Info label="Carburant">{label(FUEL_TYPES, v.fuelType)}</Info><Info label="Châssis (VIN)">{v.vin ?? "—"}</Info>
        <Info label="Acquisition">{v.acquisitionDate ? `${fmtDate(v.acquisitionDate)} · ${formatMoney(d(v.acquisitionCost).toNumber(), ctx.company.currency)}` : "—"}</Info>
        <Info label="Assurance"><Badge variant={STATE[ins.state]!.variant}>{STATE[ins.state]!.text}</Badge> {ins.expiresAt && <span className="text-xs font-normal text-muted-foreground">{fmtDate(ins.expiresAt)}</span>}</Info>
        <Info label="Visite technique"><Badge variant={STATE[vt.state]!.variant}>{STATE[vt.state]!.text}</Badge> {vt.expiresAt && <span className="text-xs font-normal text-muted-foreground">{fmtDate(vt.expiresAt)}</span>}</Info>
        {v.notes && <div className="col-span-2"><Info label="Notes">{v.notes}</Info></div>}
      </CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Chauffeur et affectations</CardTitle>{manage && v.status === "ACTIVE" && <AssignDialog vehicleId={v.id} drivers={drivers} />}</CardHeader><CardContent>
        <p className="mb-3 text-sm">{current ? <>Chauffeur actuel : <span className="font-medium">{current.driver.fullName}</span> depuis le {fmtDate(current.startDate)}</> : "Aucun chauffeur affecté."}</p>
        <ul className="divide-y text-sm">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2"><span>{a.driver.fullName} <span className="text-xs text-muted-foreground">du {fmtDate(a.startDate)} {a.endDate ? `au ${fmtDate(a.endDate)}` : "à ce jour"}</span></span>
              {manage && !a.endDate && <ActionButton action={endAssignmentAction} input={{ id: a.id }} variant="ghost" size="sm" label="Terminer" success="Affectation terminée" />}</li>
          ))}
        </ul>
      </CardContent></Card>
    </div>
  );
}

async function Missions({ ctx, vehicleId }: { ctx: Ctx; vehicleId: string }) {
  const rows = await ctx.db.trip.findMany({ where: { vehicleId }, orderBy: { plannedStart: "desc" }, take: 50, include: { driver: { select: { fullName: true } } } });
  return (
    <Card className="overflow-hidden p-0"><Table>
      <TableHeader><TableRow><TableHead>Mission</TableHead><TableHead>Trajet</TableHead><TableHead className="hidden sm:table-cell">Chauffeur</TableHead><TableHead className="text-right">Km</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Aucune mission.</TableCell></TableRow>}
        {rows.map((t) => <TableRow key={t.id}><TableCell className="text-sm font-medium">{t.number}<div className="text-xs font-normal text-muted-foreground">{fmtDate(t.plannedStart)}</div></TableCell><TableCell className="text-sm">{t.origin} → {t.destination}</TableCell><TableCell className="hidden text-sm sm:table-cell">{t.driver.fullName}</TableCell><TableCell className="text-right text-sm tabular">{t.distanceKm?.toLocaleString("fr-FR") ?? "—"}</TableCell><TableCell><Status value={t.status} /></TableCell></TableRow>)}
      </TableBody>
    </Table></Card>
  );
}

async function Fuel({ ctx, vehicleId, vehicles, drivers }: { ctx: Ctx; vehicleId: string; vehicles: { id: string; name: string }[]; drivers: { id: string; name: string }[] }) {
  const rows = await ctx.db.fuelLog.findMany({ where: { vehicleId }, orderBy: [{ date: "desc" }, { odometer: "desc" }], take: 100 });
  const stats = fuelStats(rows.map((r) => ({ date: r.date, liters: d(r.liters).toNumber(), odometer: r.odometer, fullTank: r.fullTank })));
  const manage = ctx.can("fleet.fuel.manage");
  const finance = ctx.hasModule("finance") && ctx.can("finance.expense.create") && manage;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{stats.per100 === null ? "Consommation : au moins deux pleins complets sont nécessaires." : <>Consommation moyenne : <span className="font-semibold text-foreground">{stats.per100.toLocaleString("fr-FR")} L/100 km</span> sur {stats.distance.toLocaleString("fr-FR")} km</>}</p>{manage && <FuelDialog vehicles={vehicles} drivers={drivers} vehicleId={vehicleId} />}</div>
      <Card className="overflow-hidden p-0"><Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Km</TableHead><TableHead className="text-right">Litres</TableHead><TableHead className="text-right">Montant</TableHead><TableHead className="w-28"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Aucun plein.</TableCell></TableRow>}
          {rows.map((r) => (
            <TableRow key={r.id}><TableCell className="text-sm">{fmtDate(r.date)} {!r.fullTank && <Badge variant="outline">partiel</Badge>}<div className="text-xs text-muted-foreground">{r.station}</div></TableCell><TableCell className="text-right text-sm tabular">{r.odometer.toLocaleString("fr-FR")}</TableCell><TableCell className="text-right text-sm tabular">{d(r.liters).toNumber()}</TableCell><TableCell className="text-right text-sm tabular">{formatMoney(d(r.amount).toNumber(), ctx.company.currency)}</TableCell>
              <TableCell className="text-right">{finance && !r.expenseId && <ActionButton action={createExpenseFromCostAction} input={{ source: "fuel" as const, id: r.id }} variant="ghost" size="sm" label="Dépense" success="Dépense créée (brouillon)" />}{manage && !r.expenseId && <ActionButton action={deleteFuelAction} input={{ id: r.id }} variant="ghost" size="icon" label="" ariaLabel="Supprimer ce plein" icon={<Trash2 className="size-4" />} success="Plein supprimé" confirm={{ title: "Supprimer ce plein ?", confirmLabel: "Supprimer" }} />}{r.expenseId && <span className="text-xs text-muted-foreground">En dépense</span>}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table></Card>
    </div>
  );
}

async function Maintenance({ ctx, vehicleId, vehicles, suppliers }: { ctx: Ctx; vehicleId: string; vehicles: { id: string; name: string }[]; suppliers: { id: string; name: string }[] }) {
  const rows = await ctx.db.maintenanceRecord.findMany({ where: { vehicleId }, orderBy: [{ date: "desc" }], take: 100 });
  const manage = ctx.can("fleet.maintenance.manage");
  const finance = ctx.hasModule("finance") && ctx.can("finance.expense.create") && manage;
  return (
    <div className="space-y-4">
      {manage && <div className="flex justify-end"><MaintenanceDialog vehicles={vehicles} vehicleId={vehicleId} suppliers={suppliers} /></div>}
      <Card className="overflow-hidden p-0"><Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Entretien</TableHead><TableHead className="hidden sm:table-cell">Prochaine échéance</TableHead><TableHead className="text-right">Coût</TableHead><TableHead>Statut</TableHead><TableHead className="w-40"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Aucun entretien.</TableCell></TableRow>}
          {rows.map((m) => (
            <TableRow key={m.id}><TableCell className="whitespace-nowrap text-sm">{fmtDate(m.date)}</TableCell><TableCell className="text-sm">{m.description}<div className="text-xs text-muted-foreground">{label(MAINTENANCE_TYPES, m.type)}{m.odometer !== null ? ` · ${m.odometer.toLocaleString("fr-FR")} km` : ""}</div></TableCell>
              <TableCell className="hidden text-sm sm:table-cell">{[m.nextDueDate ? fmtDate(m.nextDueDate) : null, m.nextDueKm ? `${m.nextDueKm.toLocaleString("fr-FR")} km` : null].filter(Boolean).join(" ou ") || "—"}</TableCell>
              <TableCell className="text-right text-sm tabular">{formatMoney(d(m.cost).toNumber(), ctx.company.currency)}</TableCell><TableCell><Status value={m.status === "DONE" ? "DONE" : m.status === "PLANNED" ? "PLANNED" : "CANCELLED"} /></TableCell>
              <TableCell className="text-right">{manage && m.status === "PLANNED" && <><CompleteMaintenanceDialog id={m.id} /><ActionButton action={cancelMaintenanceAction} input={{ id: m.id }} variant="ghost" size="sm" label="Annuler" success="Entretien annulé" /></>}{finance && m.status === "DONE" && !m.expenseId && d(m.cost).gt(0) && <ActionButton action={createExpenseFromCostAction} input={{ source: "maintenance" as const, id: m.id }} variant="ghost" size="sm" label="Dépense" success="Dépense créée (brouillon)" />}{manage && !m.expenseId && m.status !== "PLANNED" && <ActionButton action={deleteMaintenanceAction} input={{ id: m.id }} variant="ghost" size="icon" label="" ariaLabel="Supprimer cet entretien" icon={<Trash2 className="size-4" />} success="Entretien supprimé" confirm={{ title: "Supprimer cet entretien ?", confirmLabel: "Supprimer" }} />}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table></Card>
    </div>
  );
}

async function VehicleFines({ ctx, vehicleId }: { ctx: Ctx; vehicleId: string }) {
  const rows = await ctx.db.trafficFine.findMany({ where: { vehicleId }, orderBy: { date: "desc" }, take: 100, include: { driver: { select: { fullName: true } } } });
  return (
    <Card className="overflow-hidden p-0"><Table>
      <TableHeader><TableRow><TableHead>PV</TableHead><TableHead>Infraction</TableHead><TableHead className="hidden sm:table-cell">Chauffeur</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Aucune contravention.</TableCell></TableRow>}
        {rows.map((f) => <TableRow key={f.id}><TableCell className="text-sm"><Link href={`/app/fleet/contraventions/${f.id}`} className="font-medium hover:text-brand">{f.number}</Link><div className="text-xs text-muted-foreground">{fmtDate(f.date)}</div></TableCell><TableCell className="text-sm">{f.offence}</TableCell><TableCell className="hidden text-sm sm:table-cell">{f.driver?.fullName ?? "—"}</TableCell><TableCell className="text-right text-sm tabular">{formatMoney(d(f.amount).toNumber(), ctx.company.currency)}</TableCell><TableCell><Status value={f.status} /></TableCell></TableRow>)}
      </TableBody>
    </Table></Card>
  );
}

async function Costs({ ctx, vehicleId, sp }: { ctx: Ctx; vehicleId: string; sp: SearchParams }) {
  const period = enumParam(sp, "periode", ["mois", "annee", "tout"] as const) ?? "annee";
  const now = new Date();
  const from = period === "mois" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : period === "annee" ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) : undefined;
  const [e] = await vehicleEconomics(ctx, { from, vehicleId });
  const money = (n: number) => formatMoney(n, ctx.company.currency);
  if (!e) return null;
  const lines: [string, number][] = [["Carburant", e.fuel], ["Entretiens et réparations", e.maintenance], ["Assurance, visite, documents", e.compliance], ["Contraventions", e.fines]];
  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-sm">{(["mois", "annee", "tout"] as const).map((p) => <Button key={p} asChild size="sm" variant={p === period ? "default" : "outline"}><Link href={`/app/fleet/vehicules/${vehicleId}?onglet=couts&periode=${p}`}>{p === "mois" ? "Ce mois" : p === "annee" ? "Cette année" : "Tout"}</Link></Button>)}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Produit des missions", money(e.revenue)], ["Coûts totaux", money(e.cost)], ["Marge", money(e.margin)], ["Coût au km", e.costPerKm === null ? "—" : money(e.costPerKm)]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-xl font-semibold tabular">{v}</p></Card>)}
      </div>
      <Card className="p-4"><div className="grid gap-4 sm:grid-cols-2">
        <ul className="space-y-1 text-sm">{lines.map(([l, n]) => <li key={l} className="flex justify-between"><span>{l}</span><span className="tabular">{money(n)}</span></li>)}</ul>
        <ul className="space-y-1 text-sm"><li className="flex justify-between"><span>Missions terminées</span><span className="tabular">{e.trips}</span></li><li className="flex justify-between"><span>Kilomètres facturables</span><span className="tabular">{e.km.toLocaleString("fr-FR")} km</span></li><li className="flex justify-between"><span>Litres</span><span className="tabular">{e.liters.toLocaleString("fr-FR")} L</span></li><li className="flex justify-between"><span>Consommation</span><span className="tabular">{e.per100 === null ? "—" : `${e.per100} L/100 km`}</span></li></ul>
      </div></Card>
      <p className="text-xs text-muted-foreground">Produit : missions terminées sur la période. Coûts : pleins, entretiens réalisés, documents (date de début) et contraventions non annulées. Une dépense créée dans Finance à partir d&apos;un de ces coûts n&apos;est pas comptée deux fois.</p>
    </div>
  );
}
