import "server-only";
import { d, num } from "@/core/money";
import type { DateRange } from "@/core/tenant/period";
import type { TenantContext } from "@/core/tenant/context";
import type { Kpi } from "@/components/app/kpi-cards";
import { formatMoney } from "@/lib/reference-data";

type Ctx = TenantContext;
const fmt = (n: unknown, cur: string) => formatMoney(num(n as number), cur);

/** Chiffres clés des commandes fournisseur de la période. */
export async function purchaseOrderKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (statuses: ("DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "BILLED")[]) => ctx.db.purchaseOrder.aggregate({ where: { orderDate: period, status: { in: statuses } }, _count: true, _sum: { total: true } });
  const [pending, toReceive, received, drafts] = await Promise.all([by(["PENDING_APPROVAL"]), by(["APPROVED", "PARTIALLY_RECEIVED"]), by(["RECEIVED", "BILLED"]), by(["DRAFT"])]);
  return [
    { label: "À valider", count: pending._count, amount: fmt(pending._sum.total ?? 0, cur), tag: "TTC", tone: "amber" },
    { label: "À réceptionner", count: toReceive._count, amount: fmt(toReceive._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
    { label: "Reçues", count: received._count, amount: fmt(received._sum.total ?? 0, cur), tag: "TTC", tone: "green" },
    { label: "Brouillons", count: drafts._count, amount: fmt(drafts._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
  ];
}

/** Chiffres clés des factures fournisseur de la période. */
export async function billKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const today = new Date(new Date().toDateString());
  const open = ["POSTED", "PARTIALLY_PAID"] as const;
  const [booked, toPay, late] = await Promise.all([
    ctx.db.supplierBill.aggregate({ where: { billDate: period, status: { in: [...open, "PAID"] } }, _count: true, _sum: { total: true, amountPaid: true } }),
    ctx.db.supplierBill.aggregate({ where: { billDate: period, status: { in: [...open] } }, _count: true, _sum: { total: true, amountPaid: true } }),
    ctx.db.supplierBill.aggregate({ where: { billDate: period, status: { in: [...open] }, dueDate: { lt: today } }, _count: true, _sum: { total: true, amountPaid: true } }),
  ]);
  const rest = (a: { _sum: { total: unknown; amountPaid: unknown } }) => d((a._sum.total ?? 0) as number).minus(d((a._sum.amountPaid ?? 0) as number)).toNumber();
  return [
    { label: "Factures fournisseur enregistrées", count: booked._count, amount: fmt(booked._sum.total ?? 0, cur), tag: "TTC", tone: "blue" },
    { label: "Déjà réglé", amount: fmt(booked._sum.amountPaid ?? 0, cur), tone: "green" },
    { label: "À payer", count: toPay._count, amount: fmt(rest(toPay), cur), tag: "reste dû", tone: "amber" },
    { label: "Échues, à régler", count: late._count, amount: fmt(rest(late), cur), tag: "reste dû", tone: "red" },
  ];
}

export async function supplierPaymentKpis(ctx: Ctx, period: DateRange): Promise<Kpi[]> {
  const cur = ctx.company.currency;
  const by = (status: "PENDING" | "VALIDATED" | "CANCELLED") => ctx.db.payment.aggregate({ where: { direction: "OUT", date: period, status }, _count: true, _sum: { amount: true } });
  const [ok, pending, cancelled] = await Promise.all([by("VALIDATED"), by("PENDING"), by("CANCELLED")]);
  return [
    { label: "Règlements validés", count: ok._count, amount: fmt(ok._sum.amount ?? 0, cur), tone: "green" },
    { label: "En attente de validation", count: pending._count, amount: fmt(pending._sum.amount ?? 0, cur), tone: "amber" },
    { label: "Annulés", count: cancelled._count, amount: fmt(cancelled._sum.amount ?? 0, cur), tone: "red" },
  ];
}
