import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CircleCheck } from "lucide-react";
import { forbidden, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { d } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { formatMoney } from "@/lib/reference-data";
import { fleetAttention, vehicleEconomics } from "@/modules/fleet/costs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Flotte" };

export default async function FleetOverviewPage() {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.vehicle.read")) {
    if (ctx.can("fleet.fine.read")) redirect("/app/fleet/contraventions");
    forbidden();
  }
  const cur = ctx.company.currency;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [byStatus, inProgress, attention, eco, toPay] = await Promise.all([
    ctx.db.vehicle.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    ctx.db.trip.count({ where: { status: "IN_PROGRESS" } }),
    fleetAttention(ctx.db, ctx.company.id),
    vehicleEconomics(ctx, { from: monthStart }),
    ctx.can("fleet.fine.read") ? ctx.db.trafficFine.aggregate({ where: { status: "TO_PAY" }, _sum: { amount: true }, _count: { _all: true } }) : Promise.resolve(null),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
  const total = byStatus.filter((x) => x.status !== "SOLD").reduce((a, x) => a + x._count._all, 0); // les véhicules vendus ne comptent plus dans la flotte
  const tot = eco.reduce((a, e) => ({ revenue: a.revenue + e.revenue, cost: a.cost + e.cost, km: a.km + e.km }), { revenue: 0, cost: 0, km: 0 });
  const money = (n: number) => formatMoney(n, cur);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Véhicules" value={String(total)} hint={`${count("ACTIVE")} en service · ${count("IN_MAINTENANCE")} en maintenance · ${count("OUT_OF_SERVICE")} hors service`} href="/app/fleet/vehicules" />
        <Kpi label="Missions en cours" value={String(inProgress)} href="/app/fleet/missions?statut=IN_PROGRESS" />
        <Kpi label="Coûts du mois" value={money(tot.cost)} hint={`Produit ${money(tot.revenue)} · marge ${money(tot.revenue - tot.cost)}`} tone={tot.revenue - tot.cost < 0 ? "danger" : undefined} href="/app/fleet/vehicules" />
        {toPay && <Kpi label="Contraventions à payer" value={money(d(toPay._sum.amount ?? 0).toNumber())} hint={`${toPay._count._all} PV`} tone={toPay._count._all > 0 ? "warning" : undefined} href="/app/fleet/contraventions?statut=TO_PAY" />}
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4" /> À traiter ({attention.length})</CardTitle></CardHeader>
        <CardContent>
          {attention.length === 0 ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleCheck className="size-4 text-success" /> Assurances, visites techniques, permis et entretiens sont à jour.</p> : (
            <ul className="divide-y text-sm">
              {attention.slice(0, 20).map((a, i) => (
                <li key={i} className="py-2"><Link href={a.href} className={cn("hover:underline", a.severity === "danger" && "font-medium text-destructive")}>{a.label}</Link></li>
              ))}
              {attention.length > 20 && <li className="pt-2 text-xs text-muted-foreground">… et {attention.length - 20} autres.</li>}
            </ul>
          )}
        </CardContent>
      </Card>

      {eco.length > 0 && (
        <Card className="overflow-hidden p-0">
          <CardHeader><CardTitle className="text-base">Coûts et rentabilité — mois en cours</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Véhicule</TableHead><TableHead className="text-right">Km</TableHead><TableHead className="hidden text-right sm:table-cell">Produit</TableHead><TableHead className="text-right">Coûts</TableHead><TableHead className="text-right">Marge</TableHead><TableHead className="hidden text-right md:table-cell">Coût / km</TableHead></TableRow></TableHeader>
            <TableBody>
              {[...eco].sort((a, b) => b.cost - a.cost).slice(0, 10).map((e) => (
                <TableRow key={e.vehicleId}>
                  <TableCell><Link href={`/app/fleet/vehicules/${e.vehicleId}?onglet=couts`} className="font-medium hover:text-brand">{e.plate}</Link><div className="text-xs text-muted-foreground">{e.label}</div></TableCell>
                  <TableCell className="text-right tabular">{e.km.toLocaleString("fr-FR")}</TableCell>
                  <TableCell className="hidden text-right tabular sm:table-cell">{money(e.revenue)}</TableCell>
                  <TableCell className="text-right tabular">{money(e.cost)}</TableCell>
                  <TableCell className={cn("text-right tabular", e.margin < 0 && "text-destructive")}>{money(e.margin)}</TableCell>
                  <TableCell className="hidden text-right tabular md:table-cell">{e.costPerKm === null ? "—" : money(e.costPerKm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, href, tone }: { label: string; value: string; hint?: string; href: string; tone?: "danger" | "warning" }) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:border-brand"><CardContent className="space-y-1 p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("truncate text-2xl font-semibold tracking-tight tabular", tone === "danger" && "text-destructive", tone === "warning" && "text-warning")}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent></Card>
    </Link>
  );
}
