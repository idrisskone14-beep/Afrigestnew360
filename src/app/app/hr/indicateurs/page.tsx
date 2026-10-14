import type { Metadata } from "next";
import { BarList } from "@/components/app/bar-list";
import { KpiCards, type Kpi } from "@/components/app/kpi-cards";
import { SeriesChart } from "@/components/app/lazy-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/core/tenant/guards";
import { selectedYear } from "@/core/tenant/period";
import { formatMoney } from "@/lib/reference-data";
import { hrIndicators } from "@/modules/hr/analytics";

export const metadata: Metadata = { title: "Indicateurs RH" };

const pctText = (v: number | null) => (v === null ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v)} %`);
const nb = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);

export default async function HrIndicatorsPage() {
  const ctx = await requirePagePermission("hr.employee.read");
  const year = await selectedYear();
  const r = await hrIndicators(ctx, year);
  const cur = ctx.company.currency;
  const partial = r.asOf < `${year}-12-31`;

  const kpis: Kpi[] = [
    { label: "Effectif", amount: `${r.headcount.end} salarié${r.headcount.end > 1 ? "s" : ""}`, tag: `${r.headcount.start} au 1er janvier`, tone: "blue" },
    { label: "Arrivées / départs", amount: `${r.entries} / ${r.exits}`, tag: `solde ${r.entries - r.exits >= 0 ? "+" : ""}${r.entries - r.exits}`, tone: "green" },
    { label: "Rotation du personnel", amount: pctText(r.turnoverPct), tag: "départs ÷ effectif moyen", tone: "amber" },
    { label: "Ancienneté moyenne", amount: r.tenureYears === null ? "—" : `${nb(r.tenureYears)} an${r.tenureYears >= 2 ? "s" : ""}`, tone: "blue" },
    ...(r.attendance ? [{ label: "Absentéisme", amount: pctText(r.attendance.absentPct), tag: `${r.attendance.absent} j sur ${r.attendance.tracked} pointés`, tone: "red" as const }] : []),
    { label: "Congés pris", amount: `${nb(r.leave.daysTaken)} j`, tag: r.leave.ratePct === null ? undefined : `${pctText(r.leave.ratePct)} du temps`, count: r.leave.requests, tone: "amber" },
    ...(r.pay ? [{ label: r.pay.source === "payroll" ? "Masse salariale brute" : "Masse salariale mensuelle (estimée)", amount: formatMoney(r.pay.totals.gross, cur), tag: r.pay.source === "payroll" ? "paies validées" : "salaires de base", tone: "green" as const }] : []),
  ];
  const movement = r.movements.map((m) => ({ month: m.month, headcount: m.headcount, entries: m.entries, exits: m.exits }));
  const absentByMonth = r.attendance?.byMonth ?? [];
  const leaveByMonth = r.leave.byMonth.map((v, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, days: v }));

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Année <strong className="text-foreground">{year}</strong> (celle choisie en haut de l&apos;écran){partial ? `, arrêtée au ${new Date(`${r.asOf}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" })}` : ""}.
        Le taux de rotation rapporte les départs de l&apos;année à l&apos;effectif moyen ; l&apos;absentéisme ne mesure que les jours enregistrés dans les présences ; le taux de congé rapporte les jours pris au temps de travail théorique.
      </p>
      <KpiCards items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Effectif en fin de mois</CardTitle></CardHeader><CardContent><SeriesChart ariaLabel="Effectif en fin de mois" data={movement} series={[{ key: "headcount", label: "Effectif" }]} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Arrivées et départs par mois</CardTitle></CardHeader><CardContent><SeriesChart ariaLabel="Arrivées et départs par mois" data={movement} series={[{ key: "entries", label: "Arrivées", color: "var(--viz-1)" }, { key: "exits", label: "Départs", color: "var(--viz-2)" }]} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Jours de congé pris par mois</CardTitle></CardHeader><CardContent><SeriesChart ariaLabel="Jours de congé pris par mois" data={leaveByMonth} series={[{ key: "days", label: "Jours de congé" }]} format="days" /></CardContent></Card>
        {r.attendance && <Card><CardHeader><CardTitle className="text-base">Absences pointées par mois</CardTitle></CardHeader><CardContent>{r.attendance.tracked === 0 ? <p className="text-sm text-muted-foreground">Aucune présence enregistrée sur {year} : renseignez l&apos;onglet Présences pour suivre l&apos;absentéisme.</p> : <SeriesChart ariaLabel="Absences pointées par mois" data={absentByMonth} series={[{ key: "absent", label: "Jours d'absence", color: "var(--viz-2)" }]} />}</CardContent></Card>}
        {r.pay && r.pay.source === "payroll" && <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Masse salariale par mois</CardTitle></CardHeader><CardContent><SeriesChart ariaLabel="Masse salariale par mois" data={r.pay.byMonth} series={[{ key: "gross", label: "Brut" }, { key: "employerCost", label: "Coût employeur", color: "var(--viz-2)" }]} format="money" currency={cur} /><p className="mt-3 text-xs text-muted-foreground">Charges patronales : {pctText(r.pay.employerOnGrossPct)} du brut. Salaire brut moyen du dernier mois payé : {r.pay.avgGrossPerEmployee === null ? "—" : formatMoney(r.pay.avgGrossPerEmployee, cur)}.</p></CardContent></Card>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Répartition par département</CardTitle></CardHeader>
          <CardContent><BarList rows={r.byDepartment.map((d) => ({ label: d.name, value: d.headcount, hint: d.gross !== null ? `${formatMoney(d.gross, cur)}${r.pay?.source === "estimate" ? " /mois" : ""}` : undefined }))} format={(n) => `${n}`} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Pyramide des âges</CardTitle></CardHeader>
          <CardContent><BarList rows={r.ages.map((a) => ({ label: a.label, value: a.count }))} color="var(--viz-2)" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Motifs de départ</CardTitle></CardHeader>
          <CardContent>{r.exitReasons.length === 0 ? <p className="text-sm text-muted-foreground">Aucun départ sur la période.</p> : <BarList rows={r.exitReasons.map((x) => ({ label: x.reason, value: x.count }))} color="var(--viz-2)" />}</CardContent>
        </Card>
      </div>

      {r.leave.byType.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Congés pris par type</CardTitle></CardHeader>
          <CardContent><BarList rows={r.leave.byType.map((t) => ({ label: t.name, value: t.days }))} format={(n) => `${nb(n)} j`} /></CardContent>
        </Card>
      )}
    </div>
  );
}
