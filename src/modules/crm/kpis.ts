import "server-only";
import { num } from "@/core/money";
import type { DateRange } from "@/core/tenant/period";
import type { TenantContext } from "@/core/tenant/context";
import type { Kpi } from "@/components/app/kpi-cards";
import { formatMoney } from "@/lib/reference-data";

/** Chiffres clés des prospects créés pendant la période : nombre et valeur estimée par étape. */
export async function leadKpis(ctx: TenantContext, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (statuses: ("NEW" | "CONTACTED" | "QUALIFIED" | "LOST" | "CONVERTED")[]) => ctx.db.lead.aggregate({ where: { deletedAt: null, createdAt: period, status: { in: statuses } }, _count: true, _sum: { estimatedValue: true } });
  const [fresh, contacted, qualified, won] = await Promise.all([by(["NEW"]), by(["CONTACTED"]), by(["QUALIFIED"]), by(["CONVERTED"])]);
  const f = (a: { _sum: { estimatedValue: unknown } }) => formatMoney(num((a._sum.estimatedValue ?? 0) as number), cur);
  return [
    { label: "Nouveaux", count: fresh._count, amount: f(fresh), tag: "estimé", tone: "blue" },
    { label: "Contactés", count: contacted._count, amount: f(contacted), tag: "estimé", tone: "amber" },
    { label: "Qualifiés", count: qualified._count, amount: f(qualified), tag: "estimé", tone: "green" },
    { label: "Convertis en clients", count: won._count, amount: f(won), tag: "estimé", tone: "blue" },
  ];
}
