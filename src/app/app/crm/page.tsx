import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Target, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { pipelineBoard } from "@/modules/crm/service";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmOverview() {
  const ctx = await requirePagePermission("crm.customer.read");
  const canOpps = ctx.can("crm.opportunity.read");
  const [customers, newLeads, board, tasks] = await Promise.all([
    ctx.db.customer.count({ where: { deletedAt: null, isActive: true } }),
    ctx.can("crm.lead.read") ? ctx.db.lead.count({ where: { deletedAt: null, status: { in: ["NEW", "CONTACTED"] } } }) : Promise.resolve(0),
    canOpps ? pipelineBoard(ctx) : Promise.resolve(null),
    ctx.can("crm.activity.read")
      ? ctx.db.activity.findMany({ where: { doneAt: null, ownerId: ctx.user.id, dueAt: { not: null } }, orderBy: { dueAt: "asc" }, take: 6, include: { customer: { select: { name: true } } } })
      : Promise.resolve([]),
  ]);
  const open = board?.opps.filter((o) => o.status === "OPEN") ?? [];
  const prob = new Map(board?.stages.map((s) => [s.id, s.probability]) ?? []);
  const pipelineValue = open.reduce((a, o) => a + num(o.amount), 0);
  const weighted = open.reduce((a, o) => a + (num(o.amount) * (prob.get(o.stageId) ?? 0)) / 100, 0);
  const cur = ctx.company.currency;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Users className="size-4" />} label="Clients actifs" value={String(customers)} href="/app/crm/clients" />
        <Kpi icon={<UserPlus className="size-4" />} label="Prospects à traiter" value={String(newLeads)} href="/app/crm/prospects" />
        {canOpps && <Kpi icon={<Target className="size-4" />} label="Pipeline ouvert" value={formatMoney(pipelineValue, cur)} hint={`${open.length} opportunité${open.length > 1 ? "s" : ""} · pondéré ${formatMoney(Math.round(weighted), cur)}`} href="/app/crm/opportunites" />}
        <Kpi icon={<CalendarClock className="size-4" />} label="Mes relances" value={String(tasks.length)} hint="À faire" href="/app/crm/activites" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {board && (
          <Card>
            <CardHeader><CardTitle className="text-base">Répartition du pipeline</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {board.stages.filter((s) => s.kind === "OPEN").map((s) => {
                const list = open.filter((o) => o.stageId === s.id);
                const sum = list.reduce((a, o) => a + num(o.amount), 0);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{s.name} <span className="text-muted-foreground">· {list.length}</span></span>
                    <span className="tabular text-muted-foreground">{formatMoney(sum, cur)}</span>
                  </div>
                );
              })}
              {open.length === 0 && <p className="text-sm text-muted-foreground">Aucune opportunité en cours.</p>}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-base">Mes prochaines relances</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {tasks.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Rien à relancer pour le moment.</p>}
            {tasks.map((t) => (
              <Link key={t.id} href="/app/crm/activites" className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{t.subject}</p><p className="text-xs text-muted-foreground">{t.customer?.name ?? "—"}</p></div>
                <span className={`text-xs ${t.dueAt && t.dueAt < new Date() ? "font-medium text-destructive" : "text-muted-foreground"}`}>{fmtDate(t.dueAt)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

function Kpi({ icon, label, value, hint, href }: { icon: React.ReactNode; label: string; value: string; hint?: string; href: string }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-brand/50">
        <CardContent className="space-y-1 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
          <div className="truncate text-2xl font-semibold tracking-tight tabular">{value}</div>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}
