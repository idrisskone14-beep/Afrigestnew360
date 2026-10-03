import "server-only";
import { platformDb } from "@/core/db/client";

const DAY = 86_400_000;

/** Revenu mensuel récurrent normalisé (annuel ÷ 12), par devise. Les essais n'y sont pas comptés. */
export function computeRecurring(
  subs: { status: string; billingCycle: string; priceAmount: { toString(): string }; currency: string }[],
): { currency: string; mrr: number; arr: number }[] {
  const byCurrency = new Map<string, number>();
  for (const s of subs) {
    if (s.status !== "ACTIVE" && s.status !== "PAST_DUE") continue;
    const monthly = Number(s.priceAmount.toString()) / (s.billingCycle === "YEARLY" ? 12 : 1);
    byCurrency.set(s.currency, (byCurrency.get(s.currency) ?? 0) + monthly);
  }
  return [...byCurrency.entries()].map(([currency, mrr]) => ({ currency, mrr: Math.round(mrr), arr: Math.round(mrr * 12) }));
}

export async function getPlatformStats() {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const since180 = new Date(now - 180 * DAY);

  const [
    companiesTotal, companiesActive, companiesSuspended, usersTotal, usersActive30, newUsers30, newCompanies30,
    demoNew, demoTotal, subs, moduleUsage, recentCompanies, recentActivity, signups,
  ] = await Promise.all([
    platformDb.company.count({ where: { deletedAt: null } }),
    platformDb.company.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    platformDb.company.count({ where: { deletedAt: null, status: "SUSPENDED" } }),
    platformDb.user.count({ where: { deletedAt: null } }),
    platformDb.user.count({ where: { deletedAt: null, lastLoginAt: { gte: since30 } } }),
    platformDb.user.count({ where: { deletedAt: null, createdAt: { gte: since30 } } }),
    platformDb.company.count({ where: { deletedAt: null, createdAt: { gte: since30 } } }),
    platformDb.demoRequest.count({ where: { status: "NEW" } }),
    platformDb.demoRequest.count(),
    platformDb.subscription.findMany({ select: { status: true, billingCycle: true, priceAmount: true, currency: true, plan: { select: { name: true } } } }),
    platformDb.companyModule.groupBy({ by: ["moduleId"], where: { enabled: true, company: { status: "ACTIVE", deletedAt: null } }, _count: { _all: true } }),
    platformDb.company.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, legalName: true, tradeName: true, status: true, createdAt: true, country: true } }),
    platformDb.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { id: true, summary: true, userLabel: true, createdAt: true, company: { select: { legalName: true } } } }),
    platformDb.company.findMany({ where: { deletedAt: null, createdAt: { gte: since180 } }, select: { createdAt: true } }),
  ]);

  const modules = await platformDb.module.findMany({ where: { kind: { not: "CORE" } }, select: { id: true, name: true, key: true } });
  const usageByModule = new Map(moduleUsage.map((m) => [m.moduleId, m._count._all]));
  const topModules = modules
    .map((m) => ({ key: m.key, name: m.name, companies: usageByModule.get(m.id) ?? 0 }))
    .sort((a, b) => b.companies - a.companies);

  const subscriptionsByStatus = subs.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
  const subscriptionsByPlan = subs.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.plan.name]: (acc[s.plan.name] ?? 0) + 1 }), {});

  // 6 derniers mois
  const months: { label: string; key: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(d), count: 0 });
  }
  for (const s of signups) {
    const m = months.find((x) => x.key === `${s.createdAt.getFullYear()}-${s.createdAt.getMonth()}`);
    if (m) m.count++;
  }

  return {
    companiesTotal, companiesActive, companiesSuspended, usersTotal, usersActive30, newUsers30, newCompanies30,
    demoNew, demoTotal, recurring: computeRecurring(subs), subscriptionsByStatus, subscriptionsByPlan, topModules,
    recentCompanies, recentActivity, signupSeries: months.map(({ label, count }) => ({ label, count })),
  };
}
