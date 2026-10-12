import "server-only";
import { d, num } from "@/core/money";
import type { DateRange } from "@/core/tenant/period";
import type { TenantContext } from "@/core/tenant/context";
import type { Kpi } from "@/components/app/kpi-cards";
import { formatMoney } from "@/lib/reference-data";

type Ctx = TenantContext;
const fmt = (n: unknown, cur: string) => formatMoney(num(n as number), cur);

/** Chiffres clés des factures de la période (montants TTC dans la devise de l'entreprise). */
export async function invoiceKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const today = new Date(new Date().toDateString());
  const live = ["ISSUED", "PARTIALLY_PAID", "PAID"] as const;
  const open = ["ISSUED", "PARTIALLY_PAID"] as const;
  const [billed, late, drafts] = await Promise.all([
    ctx.db.invoice.aggregate({ where: { issueDate: period, status: { in: [...live] } }, _count: true, _sum: { total: true, amountPaid: true } }),
    ctx.db.invoice.aggregate({ where: { issueDate: period, status: { in: [...open] }, dueDate: { lt: today } }, _count: true, _sum: { total: true, amountPaid: true, creditedAmount: true } }),
    ctx.db.invoice.aggregate({ where: { issueDate: period, status: "DRAFT" }, _count: true, _sum: { total: true } }),
  ]);
  const remaining = d(late._sum.total ?? 0).minus(d(late._sum.amountPaid ?? 0)).minus(d(late._sum.creditedAmount ?? 0));
  return [
    { label: "Chiffre d'affaires facturé", count: billed._count, amount: fmt(billed._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
    { label: "Chiffre d'affaires encaissé", amount: fmt(billed._sum.amountPaid ?? 0, cur), tag: "TTC", tone: "green" },
    { label: "Factures en retard", count: late._count, amount: fmt(remaining.toNumber(), cur), tag: "reste dû", tone: "red" },
    { label: "Brouillons à émettre", count: drafts._count, amount: fmt(drafts._sum.total ?? 0, cur), tag: "TTC", tone: "amber" },
  ];
}

export async function quoteKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (statuses: ("DRAFT" | "SENT" | "ACCEPTED" | "CONVERTED")[]) => ctx.db.quote.aggregate({ where: { issueDate: period, status: { in: statuses } }, _count: true, _sum: { total: true } });
  const [sent, won, converted, drafts] = await Promise.all([by(["SENT"]), by(["ACCEPTED"]), by(["CONVERTED"]), by(["DRAFT"])]);
  return [
    { label: "Envoyés, en attente de réponse", count: sent._count, amount: fmt(sent._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
    { label: "Acceptés", count: won._count, amount: fmt(won._sum.total ?? 0, cur), tag: "TTC", tone: "green" },
    { label: "Convertis en commande ou facture", count: converted._count, amount: fmt(converted._sum.total ?? 0, cur), tag: "TTC", tone: "amber" },
    { label: "Brouillons", count: drafts._count, amount: fmt(drafts._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
  ];
}

export async function orderKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (statuses: ("DRAFT" | "CONFIRMED" | "PARTIALLY_DELIVERED" | "DELIVERED" | "INVOICED")[]) => ctx.db.salesOrder.aggregate({ where: { orderDate: period, status: { in: statuses } }, _count: true, _sum: { total: true } });
  const [all, toDeliver, delivered, drafts] = await Promise.all([
    by(["CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "INVOICED"]), by(["CONFIRMED", "PARTIALLY_DELIVERED"]), by(["DELIVERED", "INVOICED"]), by(["DRAFT"]),
  ]);
  return [
    { label: "Commandes confirmées", count: all._count, amount: fmt(all._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
    { label: "À livrer", count: toDeliver._count, amount: fmt(toDeliver._sum.total ?? 0, cur), tag: "TTC", tone: "amber" },
    { label: "Livrées", count: delivered._count, amount: fmt(delivered._sum.total ?? 0, cur), tag: "TTC", tone: "green" },
    { label: "Brouillons", count: drafts._count, amount: fmt(drafts._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
  ];
}

export async function paymentKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (status: "PENDING" | "VALIDATED" | "CANCELLED") => ctx.db.payment.aggregate({ where: { direction: "IN", date: period, status }, _count: true, _sum: { amount: true } });
  const [ok, pending, cancelled] = await Promise.all([by("VALIDATED"), by("PENDING"), by("CANCELLED")]);
  return [
    { label: "Encaissements validés", count: ok._count, amount: fmt(ok._sum.amount ?? 0, cur), tone: "green" },
    { label: "En attente de validation", count: pending._count, amount: fmt(pending._sum.amount ?? 0, cur), tone: "amber" },
    { label: "Annulés", count: cancelled._count, amount: fmt(cancelled._sum.amount ?? 0, cur), tone: "red" },
  ];
}
