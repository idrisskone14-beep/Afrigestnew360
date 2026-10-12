import "server-only";
import { d, num } from "@/core/money";
import type { DateRange } from "@/core/tenant/period";
import type { TenantContext } from "@/core/tenant/context";
import type { Kpi } from "@/components/app/kpi-cards";
import { formatMoney } from "@/lib/reference-data";

type Ctx = TenantContext;
const fmt = (n: unknown, cur: string) => formatMoney(num(n as number), cur);

/** Chiffres clés des dépenses de la période. */
export async function expenseKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (statuses: ("DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID")[]) => ctx.db.expense.aggregate({ where: { date: period, status: { in: statuses } }, _count: true, _sum: { amount: true } });
  const [paid, toPay, pending, drafts] = await Promise.all([by(["PAID"]), by(["APPROVED"]), by(["PENDING_APPROVAL"]), by(["DRAFT"])]);
  return [
    { label: "Dépenses payées", count: paid._count, amount: fmt(paid._sum.amount ?? 0, cur), tone: "blue" },
    { label: "À payer (validées)", count: toPay._count, amount: fmt(toPay._sum.amount ?? 0, cur), tone: "amber" },
    { label: "En attente de validation", count: pending._count, amount: fmt(pending._sum.amount ?? 0, cur), tone: "red" },
    { label: "Brouillons", count: drafts._count, amount: fmt(drafts._sum.amount ?? 0, cur), tone: "blue" },
  ];
}

/** Entrées, sorties et solde de la période (mouvements valides ; les transferts entre comptes ne comptent pas). */
export async function transactionKpis(ctx: Ctx, period: DateRange, accountId?: string): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (type: "IN" | "OUT") => ctx.db.financialTransaction.aggregate({ where: { status: "VALID", type, date: period, ...(accountId ? { accountId } : {}) }, _count: true, _sum: { amount: true } });
  const [inflow, outflow] = await Promise.all([by("IN"), by("OUT")]);
  const balance = d((inflow._sum.amount ?? 0) as number).minus(d((outflow._sum.amount ?? 0) as number)).toNumber();
  return [
    { label: "Entrées", count: inflow._count, amount: fmt(inflow._sum.amount ?? 0, cur), tone: "green" },
    { label: "Sorties", count: outflow._count, amount: fmt(outflow._sum.amount ?? 0, cur), tone: "red" },
    { label: "Solde de la période", amount: formatMoney(balance, cur), tone: balance >= 0 ? "blue" : "amber" },
  ];
}
