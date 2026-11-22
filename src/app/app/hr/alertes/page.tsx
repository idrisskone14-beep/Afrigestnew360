import type { Metadata } from "next";
import Link from "next/link";
import { BellRing } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { hrAlerts } from "@/modules/hr/alerts";
import { formatMinutes } from "@/modules/hr/time";

export const metadata: Metadata = { title: "Alertes et échéances" };
type E = { firstName: string; lastName: string; number: string };
const who = (e: E) => `${e.lastName} ${e.firstName} (${e.number})`;

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{href ? <Link href={href} className="hover:text-brand">{title}</Link> : title}</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-sm">{children}</CardContent>
    </Card>
  );
}

export default async function AlertsPage() {
  const ctx = await requireModulePage("hr");
  const a = await hrAlerts(ctx);

  return (
    <div className="space-y-4">
      {a.pending > 0 && <Section title={`${a.pending} demande(s) en attente de votre validation`} href="/app/validations"><p className="text-muted-foreground">Congés, permissions, absences, heures supplémentaires, avances : à traiter dans « Validations ».</p></Section>}
      {a.count === 0 && a.pending === 0 && <EmptyState icon={<BellRing className="size-8" />} title="Rien à signaler" description="Aucune échéance ni alerte RH pour vos droits actuels." />}
      {a.contracts && a.contracts.length > 0 && (
        <Section title="Contrats arrivant à échéance (60 jours)" href="/app/hr/salaries">
          {a.contracts.map((c) => <p key={c.id}><Link href={`/app/hr/salaries/${c.employee.id}?onglet=contrats`} className="font-medium hover:text-brand">{who(c.employee)}</Link> : fin le {fmtDate(c.endDate)}</p>)}
        </Section>
      )}
      {a.sick && a.sick.length > 0 && (
        <Section title="Arrêts maladie : reprises à suivre" href="/app/hr/arrets-maladie">
          {a.sick.map((r) => <p key={r.id}><Link href={`/app/hr/arrets-maladie/${r.id}`} className="font-medium hover:text-brand">{who(r.employee)}</Link> : {r.alerts.filter((x) => x.code !== "certificate").map((x) => x.message).join(" ; ")}</p>)}
        </Section>
      )}
      {a.visits && (a.visits.overdue.length + a.visits.soon.length + a.visits.toSchedule.length > 0) && (
        <Section title="Visites médicales" href="/app/hr/visites-medicales">
          {a.visits.overdue.map((v) => <p key={v.id}><b>{who(v.employee)}</b> : visite du {fmtDate(v.scheduledOn)} non enregistrée (en retard)</p>)}
          {a.visits.soon.map((v) => <p key={v.id}><b>{who(v.employee)}</b> : visite prévue le {fmtDate(v.scheduledOn)}</p>)}
          {a.visits.toSchedule.map((v) => <p key={v.id}><b>{who(v.employee)}</b> : échéance le {fmtDate(v.nextDueOn)} — à programmer</p>)}
        </Section>
      )}
      {a.equipment && a.equipment.length > 0 && (
        <Section title="Équipements et EPI" href="/app/hr/equipements">
          {a.equipment.map((e) => <p key={e.id}><b>{e.name}</b> ({who(e.employee)}) : {e.alert === "not_returned" ? "non restitué par un salarié sorti" : e.alert === "replace_overdue" ? "remplacement dépassé" : "remplacement proche"}{e.replaceOn && e.alert !== "not_returned" ? ` (${fmtDate(e.replaceOn)})` : ""}</p>)}
        </Section>
      )}
      {a.accidents && a.accidents.length > 0 && (
        <Section title="Accidents de travail : dossiers à compléter" href="/app/hr/accidents">
          {a.accidents.map((r) => <p key={r.id}><Link href={`/app/hr/accidents/${r.id}`} className="font-medium hover:text-brand">{r.number}</Link> — {r.employeeName} : {r.gaps.filter((g) => g.blocking || g.code === "cnps_late").map((g) => g.message).join(" ; ")}</p>)}
        </Section>
      )}
      {a.repeated && a.repeated.length > 0 && (
        <Section title="Absences injustifiées répétées" href="/app/hr/absences">
          {a.repeated.map((r) => <p key={r.employeeId}><b>{r.name}</b> ({r.number}) : {r.occurrences} absence(s), {r.days} j</p>)}
          <p className="text-xs text-muted-foreground">Signal pour la RH : aucune sanction ni retenue n&apos;en découle automatiquement.</p>
        </Section>
      )}
      {a.lateness && a.lateness.length > 0 && (
        <Section title="Retards récurrents" href="/app/hr/retards">
          {a.lateness.map((r) => <p key={r.employeeId}><b>{r.name}</b> ({r.number}) : {r.count} retard(s), {formatMinutes(r.minutes)}</p>)}
          <p className="text-xs text-muted-foreground">Signal pour la RH : aucune sanction ni retenue n&apos;en découle automatiquement.</p>
        </Section>
      )}
    </div>
  );
}
