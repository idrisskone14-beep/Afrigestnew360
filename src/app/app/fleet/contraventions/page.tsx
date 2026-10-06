import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { forbidden } from "next/navigation";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { QueryTabs } from "@/components/app/query-tabs";
import { Status } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { d } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate, isPast } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { fineAnalytics, listFines } from "@/modules/fleet/fines";
import { fleetOptions } from "@/modules/fleet/lists";
import { FINE_STATUSES } from "@/modules/fleet/schemas";
import { FineDialog } from "@/modules/fleet/ui/fleet-dialogs";
import { BarsChart } from "@/components/app/lazy-charts";

export const metadata: Metadata = { title: "Contraventions" };

export default async function FinesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.fine.read")) forbidden();
  const sp = await searchParams;
  const view = enumParam(sp, "onglet", ["liste", "analyses"] as const) ?? "liste";
  const manage = ctx.can("fleet.fine.manage");
  const opt = await fleetOptions(ctx);
  return (
    <>
      <QueryTabs tabs={[{ key: "liste", label: "Contraventions" }, { key: "analyses", label: "Analyses" }]} current={view} basePath="/app/fleet/contraventions" label="Vues des contraventions" />
      {view === "liste" ? <List ctx={ctx} sp={sp} manage={manage} vehicles={opt.allVehicles} drivers={opt.drivers} /> : <Analytics ctx={ctx} sp={sp} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireModulePage>>;

async function List({ ctx, sp, manage, vehicles, drivers }: { ctx: Ctx; sp: SearchParams; manage: boolean; vehicles: { id: string; name: string }[]; drivers: { id: string; name: string }[] }) {
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", FINE_STATUSES.map((s) => s.value));
  const vehicleId = vehicles.find((v) => v.id === param(sp, "vehicule"))?.id;
  const { rows, total } = await listFines(ctx, { q: lp.q, status, vehicleId, skip: lp.skip, take: lp.take });
  return (
    <>
      <ListToolbar placeholder="N° de PV, infraction, lieu…" filters={[
        { name: "statut", label: "Statut", options: FINE_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
        { name: "vehicule", label: "Véhicule", options: vehicles.map((v) => ({ value: v.id, label: v.name })) },
      ]}>
        {manage && <FineDialog vehicles={vehicles} drivers={drivers} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<ReceiptText className="size-8" />} title="Aucune contravention" description={manage ? "Enregistrez les PV : le chauffeur est déduit de la mission ou de l'affectation en cours à la date de l'infraction." : undefined} /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>PV</TableHead><TableHead>Infraction</TableHead><TableHead className="hidden sm:table-cell">Véhicule / chauffeur</TableHead><TableHead className="text-right">Montant</TableHead><TableHead className="hidden md:table-cell">Échéance</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-sm"><Link href={`/app/fleet/contraventions/${f.id}`} className="font-medium hover:text-brand">{f.number}</Link><div className="text-xs text-muted-foreground">{fmtDate(f.date)}{f.time ? ` ${f.time}` : ""}</div></TableCell>
                  <TableCell className="text-sm">{f.offence}{f.place && <div className="text-xs text-muted-foreground">{f.place}</div>}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{f.vehicle.plate}<div className="text-xs text-muted-foreground">{f.driver?.fullName ?? "Chauffeur inconnu"}</div></TableCell>
                  <TableCell className="text-right text-sm tabular">{formatMoney(d(f.amount).toNumber(), ctx.company.currency)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{f.dueDate ? <>{fmtDate(f.dueDate)} {f.status === "TO_PAY" && isPast(f.dueDate) && <Badge variant="destructive">en retard</Badge>}</> : "—"}</TableCell>
                  <TableCell><Status value={f.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/fleet/contraventions" searchParams={sp} />
    </>
  );
}

async function Analytics({ ctx, sp }: { ctx: Ctx; sp: SearchParams }) {
  const period = enumParam(sp, "periode", ["12m", "annee", "tout"] as const) ?? "12m";
  const now = new Date();
  const from = period === "12m" ? new Date(now.getTime() - 365 * 86_400_000) : period === "annee" ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) : undefined;
  const a = await fineAnalytics(ctx, { from });
  const money = (n: number) => formatMoney(n, ctx.company.currency);
  return (
    <div className="space-y-6">
      <div className="flex gap-2 text-sm">{(["12m", "annee", "tout"] as const).map((p) => <Link key={p} href={`/app/fleet/contraventions?onglet=analyses&periode=${p}`} className={p === period ? "rounded-md bg-primary px-3 py-1 text-primary-foreground" : "rounded-md border px-3 py-1 hover:bg-muted"}>{p === "12m" ? "12 derniers mois" : p === "annee" ? "Cette année" : "Tout"}</Link>)}</div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Montant total (hors annulées)</p><p className="mt-1 text-2xl font-semibold tabular">{money(a.total)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Nombre de PV</p><p className="mt-1 text-2xl font-semibold tabular">{a.count}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">À payer</p><p className="mt-1 text-2xl font-semibold tabular">{money(a.byStatus.find((s) => s.status === "TO_PAY")?.amount ?? 0)}</p></Card>
      </div>
      {a.monthly.length > 0 && <Card className="p-4"><BarsChart data={a.monthly.map((m) => ({ month: m.month, value: m.amount }))} currency={ctx.company.currency} seriesLabel="Montant des PV par mois" /></Card>}
      <div className="grid gap-6 lg:grid-cols-2">
        <StatList money={money} title="Par véhicule" rows={a.byVehicle} empty="Aucune contravention." />
        <StatList money={money} title="Par chauffeur" rows={a.byDriver} empty="Aucun chauffeur identifié." />
        <StatList money={money} title="Infractions les plus fréquentes" rows={a.offences} empty="Aucune infraction." />
        <Card><CardHeader><CardTitle className="text-base">Récidives (12 derniers mois)</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          {a.repeatDrivers.length === 0 && a.repeatVehicles.length === 0 && a.repeatedOffences.length === 0 ? <p className="text-muted-foreground">Aucune récidive détectée.</p> : (
            <>
              {a.repeatDrivers.length > 0 && <div><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Chauffeurs avec 2 PV ou plus</p><ul>{a.repeatDrivers.map((r) => <li key={r.id} className="flex justify-between"><span>{r.label}</span><span className="tabular">{r.count} PV · {money(r.amount)}</span></li>)}</ul></div>}
              {a.repeatVehicles.length > 0 && <div><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Véhicules avec 2 PV ou plus</p><ul>{a.repeatVehicles.map((r) => <li key={r.id} className="flex justify-between"><span>{r.label}</span><span className="tabular">{r.count} PV</span></li>)}</ul></div>}
              {a.repeatedOffences.length > 0 && <div><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Même infraction répétée</p><ul>{a.repeatedOffences.map((r, i) => <li key={i}>{r.driver} — {r.offence} ({r.count} fois)</li>)}</ul></div>}
            </>
          )}
        </CardContent></Card>
      </div>
      {a.unassigned > 0 && <p className="text-xs text-muted-foreground">{a.unassigned} PV sans chauffeur identifié ne figurent pas dans le classement par chauffeur.</p>}
    </div>
  );
}

function StatList({ title, rows, empty, money }: { title: string; rows: { label: string; count: number; amount: number }[]; empty: string; money: (n: number) => string }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="divide-y text-sm">{rows.slice(0, 8).map((r, i) => <li key={i} className="flex items-center justify-between gap-3 py-1.5"><span className="truncate">{r.label}</span><span className="shrink-0 tabular text-muted-foreground">{r.count} PV · <span className="font-medium text-foreground">{money(r.amount)}</span></span></li>)}</ul>}
    </CardContent></Card>
  );
}
