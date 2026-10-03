import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarOff, ClipboardCheck, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { canSeePay, employeeOfUser, endingContracts } from "@/modules/hr/employees";
import { leaveBalances, onLeaveOn } from "@/modules/hr/leave";
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
            <Card key={b.type.id}><CardContent className="space-y-1 p-5"><p className="text-sm text-muted-foreground">{b.type.name}</p><p className="text-2xl font-semibold tabular">{b.remaining ? `${b.remaining.toNumber()} j` : `${b.taken.toNumber()} j pris`}</p><p className="text-xs text-muted-foreground">{b.entitlement ? `sur ${b.entitlement.toNumber()} j · ${b.taken.toNumber()} pris · ${b.pending.toNumber()} en attente` : `${b.pending.toNumber()} en attente`}</p></CardContent></Card>
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
  const split = byDept.map((g) => ({ label: g.departmentId ? name.get(g.departmentId) ?? "—" : "Sans département", n: g._count })).sort((a, b) => b.n - a.n);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Users className="size-4" />} label="Effectif en activité" value={String(active)} href="/app/hr/salaries?statut=ACTIVE" />
        <Kpi icon={<CalendarOff className="size-4" />} label="En congé aujourd'hui" value={String(onLeave.size)} href="/app/hr/conges" />
        <Kpi icon={<UserPlus className="size-4" />} label="Embauches ce mois" value={String(hired)} href="/app/hr/salaries" />
        {ctx.can("hr.leave.approve") && <Kpi icon={<ClipboardCheck className="size-4" />} label="Congés à traiter" value={String(pendingLeaves)} tone={pendingLeaves ? "warning" : undefined} href="/app/validations" />}
      </div>
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
