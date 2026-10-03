import "server-only";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { d, roundMoney, type Decimal } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import type { budgetSchema } from "./schemas";
import { treasuryTotal } from "./treasury";

type Ctx = TenantContext;
const DAY = 86_400_000;
const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

// ═══ Flux de trésorerie mensuels ═════════════════════════════

export interface CashflowPoint { month: string; inflow: number; outflow: number }

/** Encaissements / décaissements des N derniers mois (les transferts entre comptes sont exclus). */
export async function monthlyCashflow(ctx: Ctx, months = 6): Promise<CashflowPoint[]> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const rows = await ctx.tx((tx) => tx.$queryRaw<{ m: string; type: string; total: unknown }[]>`
    SELECT to_char("date", 'YYYY-MM') AS m, "type"::text AS type, SUM("amount") AS total
    FROM "FinancialTransaction"
    WHERE "status" = 'VALID' AND "type" IN ('IN', 'OUT') AND "date" >= ${from}
    GROUP BY 1, 2`);
  const points: CashflowPoint[] = [];
  for (let i = 0; i < months; i++) {
    const dt = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    const inflow = rows.filter((r) => r.m === key && r.type === "IN").reduce((a, r) => a + Number(r.total), 0);
    const outflow = rows.filter((r) => r.m === key && r.type === "OUT").reduce((a, r) => a + Number(r.total), 0);
    points.push({ month: key, inflow, outflow });
  }
  return points;
}

// ═══ Échéancier & prévisionnel ═══════════════════════════════

export const BUCKETS = [
  { key: "overdue", label: "En retard" }, { key: "d7", label: "0 – 7 jours" }, { key: "d30", label: "8 – 30 jours" }, { key: "d60", label: "31 – 60 jours" }, { key: "d90", label: "61 – 90 jours" }, { key: "later", label: "Au-delà" },
] as const;
type BucketKey = (typeof BUCKETS)[number]["key"];

function bucketOf(due: Date | null): BucketKey {
  if (!due) return "later";
  const days = Math.floor((due.getTime() - startOfToday().getTime()) / DAY);
  return days < 0 ? "overdue" : days <= 7 ? "d7" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "later";
}

export interface DueItem { id: string; label: string; party: string; dueDate: Date | null; balance: number; href: string }

/** Créances clients et dettes fournisseurs ouvertes, classées par échéance. Chaque source exige son module ET sa permission de lecture. */
export async function dueSchedule(ctx: Ctx) {
  const receivables: DueItem[] = [];
  const payables: DueItem[] = [];
  if (ctx.hasModule("sales") && ctx.can("finance.invoice.read")) {
    const inv = await ctx.db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, include: { customer: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 500 });
    for (const i of inv) {
      const bal = d(i.total).minus(i.amountPaid).minus(i.creditedAmount);
      if (bal.gt(0)) receivables.push({ id: i.id, label: i.number ?? "Facture", party: i.customer.name, dueDate: i.dueDate, balance: bal.toNumber(), href: `/app/sales/factures/${i.id}` });
    }
  }
  if (ctx.hasModule("purchases") && ctx.can("purchases.bill.read")) {
    const bills = await ctx.db.supplierBill.findMany({ where: { status: { in: ["POSTED", "PARTIALLY_PAID"] } }, include: { supplier: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 500 });
    for (const b of bills) {
      const bal = d(b.total).minus(b.amountPaid);
      if (bal.gt(0)) payables.push({ id: b.id, label: b.number ?? "Facture", party: b.supplier.name, dueDate: b.dueDate, balance: bal.toNumber(), href: `/app/purchases/factures/${b.id}` });
    }
  }
  const group = (items: DueItem[]) => BUCKETS.map((b) => { const rows = items.filter((i) => bucketOf(i.dueDate) === b.key); return { ...b, rows, total: rows.reduce((a, r) => a + r.balance, 0) }; });
  return { receivables: group(receivables), payables: group(payables) };
}

/**
 * Trésorerie prévisionnelle à 30/60/90 jours = solde actuel + créances échues d'ici là − dettes échues d'ici là
 * (les retards sont supposés réglés immédiatement : c'est une estimation, pas un engagement).
 */
export async function cashForecast(ctx: Ctx) {
  const [current, due] = await Promise.all([treasuryTotal(ctx), dueSchedule(ctx)]);
  const upTo = (g: { key: BucketKey; total: number }[], keys: BucketKey[]) => g.filter((b) => keys.includes(b.key)).reduce((a, b) => a + b.total, 0);
  const horizons = [{ days: 30, keys: ["overdue", "d7", "d30"] as BucketKey[] }, { days: 60, keys: ["overdue", "d7", "d30", "d60"] as BucketKey[] }, { days: 90, keys: ["overdue", "d7", "d30", "d60", "d90"] as BucketKey[] }];
  return {
    current: current.toNumber(),
    points: horizons.map((h) => ({ days: h.days, in: upTo(due.receivables, h.keys), out: upTo(due.payables, h.keys), balance: current.plus(upTo(due.receivables, h.keys)).minus(upTo(due.payables, h.keys)).toNumber() })),
  };
}

// ═══ Budgets ═════════════════════════════════════════════════

export interface BudgetRow { categoryId: string; name: string; budget: number[]; actual: number[] }

/** Budget et réalisé (décaissements catégorisés) par catégorie de dépense et par mois. */
export async function budgetGrid(ctx: Ctx, year: number): Promise<BudgetRow[]> {
  const categories = await ctx.db.financeCategory.findMany({ where: { kind: "EXPENSE", isActive: true }, orderBy: { name: "asc" } });
  const budgets = await ctx.db.budget.findMany({ where: { year } });
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const actuals = await ctx.tx((tx) => tx.$queryRaw<{ cat: string; m: number; total: unknown }[]>`
    SELECT "categoryId"::text AS cat, EXTRACT(MONTH FROM "date")::int AS m, SUM("amount") AS total
    FROM "FinancialTransaction"
    WHERE "status" = 'VALID' AND "type" = 'OUT' AND "categoryId" IS NOT NULL AND "date" >= ${from} AND "date" < ${to}
    GROUP BY 1, 2`);
  return categories.map((c) => {
    const budget = Array<number>(12).fill(0);
    const actual = Array<number>(12).fill(0);
    for (const b of budgets) if (b.categoryId === c.id) budget[b.month - 1] = d(b.amount).toNumber();
    for (const a of actuals) if (a.cat === c.id) actual[a.m - 1] = Number(a.total);
    return { categoryId: c.id, name: c.name, budget, actual };
  });
}

export async function saveBudget(ctx: Ctx, input: z.output<typeof budgetSchema>) {
  const cat = await ctx.db.financeCategory.findFirst({ where: { id: input.categoryId, kind: "EXPENSE" } });
  if (!cat) throw notFound("Catégorie de dépense");
  if (input.months.some((m) => m < 0)) throw businessRule("Un budget ne peut pas être négatif.");
  await ctx.tx(async (tx) => {
    for (let i = 0; i < 12; i++) {
      const amount: Decimal = roundMoney(input.months[i]!, ctx.company.currency);
      const where = { companyId_year_month_categoryId: { companyId: ctx.company.id, year: input.year, month: i + 1, categoryId: cat.id } };
      if (amount.isZero()) await tx.budget.deleteMany({ where: { year: input.year, month: i + 1, categoryId: cat.id } });
      else await tx.budget.upsert({ where, create: { companyId: ctx.company.id, year: input.year, month: i + 1, categoryId: cat.id, amount: amount.toString() }, update: { amount: amount.toString() } });
    }
  });
  const total = input.months.reduce((a, b) => a + b, 0);
  await audit(ctx, { action: "finance.budget.save", resource: "Budget", resourceId: cat.id, summary: `${ctx.user.name} a défini le budget ${input.year} de « ${cat.name} » (${formatMoney(total, ctx.company.currency)}).` });
}
