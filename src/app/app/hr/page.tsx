import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, HardHat, Hourglass, Stethoscope, HeartPulse, AlarmClock, CalendarClock, CalendarOff, ClipboardCheck, Clock, ShieldAlert, UserPlus, UserX, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { ABSENCE_SCOPE, ACCIDENT_SCOPE, ADVANCE_SCOPE, LATENESS_SCOPE, OVERTIME_SCOPE, TIMEOFF_SCOPE, employeeFilter, scopeOf } from "@/modules/hr/scope";
import { sickLeaveAlerts } from "@/modules/hr/sickleave";
import { equipmentAlerts } from "@/modules/hr/equipment";
import { visitAlerts } from "@/modules/hr/medvisits";
import { canSeePay, employeeOfUser, endingContracts } from "@/modules/hr/employees";
import { leaveBalances, onLeaveOn } from "@/modules/hr/leave";
import { BalanceCard } from "@/modules/hr/ui/balance-card";
import { LeaveRequestDialog } from "@/modules/hr/ui/leave-dialogs";
import { listLeaveTypes } from "@/modules/hr/leave";

export const metadata: Metadata = { title: "Ressources humaines" };

export default async function HrOverview() {
  const ctx = await requireTenantContext();
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  if (!ctx.can("hr.employee.read")) {
    // libre-service : mes soldes de congés
    const me = await employeeOfUser(ctx);
    if (!me) return <p className="text-sm text-muted-foreground">Votre compte n'est lié à aucune fiche salarié : contactez les ressources humaines.</p>;
    const [balances, types] = await Promise.all([leaveBalances(ctx, me.id, now.getUTCFullYear()), listLeaveTypes(ctx)]);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3"><p className="mr-auto text-sm text-muted-foreground">Bonjour {me.firstName}. Voici vos soldes de congés {now.getUTCFullYear()}.</p>{ctx.can("hr.leave.request") && <LeaveRequestDialog employees={[{ id: me.id, name: `${me.firstName} ${me.lastName}` }]} types={types.map((t) => ({ id: t.id, name: t.name }))} defaultEmployeeId={me.id} />}</div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {balances.map((b) => (
            <BalanceCard key={b.type.id} b={b} />
          ))}
        </div>
      </div>
    );
  }

  const [active, onLeave, hired, pendingLeaves, ending, byDept] = await Promise.all([
    ctx.db.employee.count({ where: { status: "ACTIVE", deletedAt: null } }),
    onLeaveOn(ctx.db, dayStart),
    ctx.db.employee.count({ where: { deletedAt: null, hireDate: { gte: monthStart } } }),
    ctx.can("hr.leave.approve") ? ctx.db.leaveRequest.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    canSeePay(ctx) ? endingContracts(ctx, 30) : Promise.resolve([]),
    ctx.db.employee.groupBy({ by: ["departmentId"], where: { status: "ACTIVE", deletedAt: null }, _count: true }),
  ]);
  const depts = await ctx.db.department.findMany({ where: { id: { in: byDept.map((g) => g.departmentId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const name = new Map(depts.map((d) => [d.id, d.name]));
  // registres : chaque indicateur n'est calculé que pour l'utilisateur qui a le droit de le voir, dans sa portée
  const [offScope, absScope, lateScope, accScope] = await Promise.all([scopeOf(ctx, TIMEOFF_SCOPE), scopeOf(ctx, ABSENCE_SCOPE), scopeOf(ctx, LATENESS_SCOPE), scopeOf(ctx, ACCIDENT_SCOPE)]);
  const [ovScope, advScope] = await Promise.all([scopeOf(ctx, OVERTIME_SCOPE), scopeOf(ctx, ADVANCE_SCOPE)]);
  const [pendingOt, pendingAdv, visits, equip] = await Promise.all([
    ovScope.kind !== "none" && ctx.can("hr.overtime.approve") ? ctx.db.overtimeRecord.count({ where: { ...employeeFilter(ovScope), status: "PENDING" } }) : Promise.resolve(null),
    advScope.kind !== "none" && ctx.can("hr.advance.approve") ? ctx.db.salaryAdvance.count({ where: { ...employeeFilter(advScope), status: "PENDING" } }) : Promise.resolve(null),
    ctx.can("hr.medvisit.read") ? visitAlerts(ctx) : Promise.resolve(null),
    ctx.can("hr.equipment.read") ? equipmentAlerts(ctx) : Promise.resolve(null),
  ]);
  const [pendingOffs, absentToday, lateMonth, openAccidents, sickOngoing, sickDue] = await Promise.all([
    offScope.kind !== "none" && ctx.can("hr.timeoff.approve") ? ctx.db.timeOffRequest.count({ where: { ...employeeFilter(offScope), status: "PENDING" } }) : Promise.resolve(null),
    absScope.kind !== "none" ? ctx.db.absenceRecord.count({ where: { ...employeeFilter(absScope), status: "APPROVED", startDate: { lte: dayStart }, endDate: { gte: dayStart } } }) : Promise.resolve(null),
    lateScope.kind !== "none" ? ctx.db.latenessRecord.count({ where: { ...employeeFilter(lateScope), date: { gte: monthStart } } }) : Promise.resolve(null),
    accScope.kind !== "none" && ctx.can("hr.accident.read") ? ctx.db.workAccident.count({ where: { ...employeeFilter(accScope), status: "OPEN" } }) : Promise.resolve(null),
    ctx.can("hr.sickleave.read") ? ctx.db.sickLeave.count({ where: { status: "ONGOING" } }) : Promise.resolve(null),
    ctx.can("hr.sickleave.read") ? sickLeaveAlerts(ctx) : Promise.resolve(null),
  ]);
  const split = byDept.map((g) => ({ label: g.departmentId ? name.get(g.departmentId) ?? "—" : "Sans département", n: g._count })).sort((a, b) => b.n - a.n);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Users className="size-4" />} label="Effectif en activité" value={String(active)} href="/app/hr/salaries?statut=ACTIVE" />
        <Kpi icon={<CalendarOff className="size-4" />} label="En congé aujourd'hui" value={String(onLeave.size)} href="/app/hr/conges" />
        <Kpi icon={<UserPlus className="size-4" />} label="Embauches ce mois" value={String(hired)} href="/app/hr/salaries" />
        {ctx.can("hr.leave.approve") && <Kpi icon={<ClipboardCheck className="size-4" />} label="Congés à traiter" value={String(pendingLeaves)} tone={pendingLeaves ? "warning" : undefined} href="/app/validations" />}
      </div>
      {(pendingOffs !== null || absentToday !== null || lateMonth !== null || openAccidents !== null || sickOngoing !== null || pendingOt !== null || pendingAdv !== null || visits !== null || equip !== null) && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {pendingOffs !== null && <Kpi icon={<Clock className="size-4" />} label="Permissions à traiter" value={String(pendingOffs)} tone={pendingOffs ? "warning" : undefined} href="/app/hr/permissions?statut=PENDING" />}
          {absentToday !== null && <Kpi icon={<UserX className="size-4" />} label="Absents aujourd'hui" value={String(absentToday)} href="/app/hr/absences?statut=APPROVED" />}
          {lateMonth !== null && <Kpi icon={<AlarmClock className="size-4" />} label="Retards du mois" value={String(lateMonth)} href="/app/hr/retards" />}
          {pendingOt !== null && <Kpi icon={<Hourglass className="size-4" />} label="Heures supp. à valider" value={String(pendingOt)} tone={pendingOt ? "warning" : undefined} href="/app/hr/heures-supplementaires?statut=PENDING" />}
          {pendingAdv !== null && <Kpi icon={<Banknote className="size-4" />} label="Avances à valider" value={String(pendingAdv)} tone={pendingAdv ? "warning" : undefined} href="/app/hr/avances?statut=PENDING" />}
          {visits !== null && <Kpi icon={<Stethoscope className="size-4" />} label="Visites à programmer ou en retard" value={String(visits.overdue.length + visits.toSchedule.length)} tone={visits.overdue.length + visits.toSchedule.length ? "warning" : undefined} href="/app/hr/visites-medicales" />}
          {equip !== null && <Kpi icon={<HardHat className="size-4" />} label="Équipements à remplacer ou à récupérer" value={String(equip.length)} tone={equip.length ? "warning" : undefined} href="/app/hr/equipements" />}
          {sickOngoing !== null && <Kpi icon={<HeartPulse className="size-4" />} label="Arrêts maladie en cours" value={String(sickOngoing)} tone={sickDue?.length ? "warning" : undefined} href="/app/hr/arrets-maladie?statut=ONGOING" />}
          {openAccidents !== null && <Kpi icon={<ShieldAlert className="size-4" />} label="Accidents ouverts" value={String(openAccidents)} tone={openAccidents ? "warning" : undefined} href="/app/hr/accidents?statut=OPEN" />}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Répartition par département</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {split.length === 0 && <p className="text-sm text-muted-foreground">Aucun salarié en activité.</p>}
            {split.map((s) => (
              <div key={s.label} className="space-y-1">
                <div className="flex justify-between text-sm"><span>{s.label}</span><span className="tabular">{s.n}</span></div>
                <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.round((s.n / Math.max(1, active)) * 100)}%`, background: "var(--viz-1)" }} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
        {canSeePay(ctx) && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4 text-muted-foreground" />Contrats arrivant à échéance (30 jours)</CardTitle></CardHeader>
            <CardContent className="divide-y p-0">
              {ending.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun contrat n'arrive à échéance prochainement.</p>}
              {ending.map((c) => <Link key={c.id} href={`/app/hr/salaries/${c.employee.id}?onglet=contrats`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{c.employee.firstName} {c.employee.lastName}</span><span className="text-xs text-muted-foreground">fin le {fmtDate(c.endDate)}</span></Link>)}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, href, tone }: { icon: React.ReactNode; label: string; value: string; href: string; tone?: "warning" }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-brand/50"><CardContent className="space-y-1 p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
        <div className={`text-2xl font-semibold tracking-tight tabular ${tone === "warning" ? "text-warning" : ""}`}>{value}</div>
      </CardContent></Card>
    </Link>
  );
}
