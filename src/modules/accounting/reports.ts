import "server-only";
import { notFound } from "@/core/errors";
import { d, type Decimal } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { GROUP_LABELS } from "./chart";

type Ctx = TenantContext;

export interface BalanceRow { id: string; code: string; name: string; class: number; debit: Decimal; credit: Decimal; balance: Decimal }
export interface Range { fiscalYearId: string; from?: Date; to?: Date }

/** Exercice par défaut : celui de la date du jour, sinon le plus récent. */
export async function defaultFiscalYear(ctx: Pick<Ctx, "db">, id?: string) {
  if (id) {
    const fy = await ctx.db.fiscalYear.findFirst({ where: { id } });
    if (!fy) throw notFound("Exercice");
    return fy;
  }
  const today = new Date();
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return (await ctx.db.fiscalYear.findFirst({ where: { startDate: { lte: day }, endDate: { gte: day } } })) ?? (await ctx.db.fiscalYear.findFirst({ orderBy: { startDate: "desc" } }));
}

const dateFilter = (r: Range) => (r.from || r.to ? { date: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } } : {});

/** Balance générale : totaux débit/crédit et solde par compte, écritures validées d'un exercice (et d'une plage de dates). */
export async function trialBalance(ctx: Ctx, r: Range) {
  const sums = await ctx.db.journalLine.groupBy({ by: ["ledgerAccountId"], where: { entry: { fiscalYearId: r.fiscalYearId, status: "POSTED", ...dateFilter(r) } }, _sum: { debit: true, credit: true } });
  const accounts = await ctx.db.ledgerAccount.findMany({ where: { id: { in: sums.map((s) => s.ledgerAccountId) } } });
  const info = new Map(accounts.map((a) => [a.id, a]));
  const rows: BalanceRow[] = sums
    .map((s) => { const a = info.get(s.ledgerAccountId)!; const debit = d(s._sum.debit ?? 0); const credit = d(s._sum.credit ?? 0); return { id: a.id, code: a.code, name: a.name, class: a.class, debit, credit, balance: debit.minus(credit) }; })
    .sort((a, b) => a.code.localeCompare(b.code));
  const totalDebit = rows.reduce((a, b) => a.plus(b.debit), d(0));
  const totalCredit = rows.reduce((a, b) => a.plus(b.credit), d(0));
  return { rows, totalDebit, totalCredit, balanced: totalDebit.eq(totalCredit) };
}

/** Grand livre d'un compte : report à l'ouverture de la plage, lignes datées avec solde progressif. */
export async function generalLedger(ctx: Ctx, input: { accountId: string; fiscalYearId: string; from?: Date; to?: Date }) {
  const account = await ctx.db.ledgerAccount.findFirst({ where: { id: input.accountId } });
  if (!account) throw notFound("Compte");
  const base = { ledgerAccountId: account.id, entry: { fiscalYearId: input.fiscalYearId, status: "POSTED" as const } };
  const opening = input.from
    ? await ctx.db.journalLine.aggregate({ where: { ...base, entry: { ...base.entry, date: { lt: input.from } } }, _sum: { debit: true, credit: true } })
    : null;
  const lines = await ctx.db.journalLine.findMany({
    where: { ...base, entry: { ...base.entry, ...dateFilter(input) } },
    include: { entry: { select: { id: true, number: true, date: true, reference: true, description: true, journal: { select: { code: true } } } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }, { position: "asc" }],
    take: 5000,
  });
  const openingBalance = d(opening?._sum.debit ?? 0).minus(opening?._sum.credit ?? 0);
  let running = openingBalance;
  const rows = lines.map((l) => { running = running.plus(l.debit).minus(l.credit); return { id: l.id, entry: l.entry, label: l.label, debit: d(l.debit), credit: d(l.credit), running }; });
  return { account, openingBalance, rows, closingBalance: running, truncated: lines.length === 5000 };
}

export async function journalListing(ctx: Ctx, p: { fiscalYearId: string; journalId?: string; from?: Date; to?: Date; status?: "DRAFT" | "POSTED"; q?: string; skip: number; take: number }) {
  const where = {
    fiscalYearId: p.fiscalYearId,
    ...(p.journalId ? { journalId: p.journalId } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...dateFilter(p),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { description: { contains: p.q, mode: "insensitive" as const } }, { reference: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.journalEntry.count({ where }),
    ctx.db.journalEntry.findMany({ where, orderBy: [{ date: "desc" }, { number: "desc" }], skip: p.skip, take: p.take, include: { journal: { select: { code: true, name: true } }, lines: { include: { ledgerAccount: { select: { code: true, name: true } } }, orderBy: { position: "asc" } } } }),
  ]);
  return { total, rows };
}

export interface StatementGroup { key: string; label: string; total: Decimal; rows: { code: string; name: string; amount: Decimal }[] }

/** Compte de résultat simplifié : produits (classe 7) − charges (classe 6) + résultat hors activités ordinaires (classe 8). */
export async function incomeStatement(ctx: Ctx, r: Range) {
  const { rows } = await trialBalance(ctx, r);
  const group = (cls: number, sign: 1 | -1): StatementGroup[] => {
    const map = new Map<string, StatementGroup>();
    for (const row of rows.filter((x) => x.class === cls)) {
      const amount = row.balance.mul(sign); // charges : débit − crédit ; produits : crédit − débit
      const key = row.code.slice(0, 2);
      const g = map.get(key) ?? { key, label: GROUP_LABELS[key] ?? `Comptes ${key}`, total: d(0), rows: [] };
      g.total = g.total.plus(amount);
      g.rows.push({ code: row.code, name: row.name, amount });
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  };
  const products = group(7, -1);
  const charges = group(6, 1);
  const hao = rows.filter((x) => x.class === 8).reduce((a, x) => a.minus(x.balance), d(0));
  const totalProducts = products.reduce((a, g) => a.plus(g.total), d(0));
  const totalCharges = charges.reduce((a, g) => a.plus(g.total), d(0));
  return { products, charges, totalProducts, totalCharges, operating: totalProducts.minus(totalCharges), hao, result: totalProducts.minus(totalCharges).plus(hao) };
}

const CONTRA = /^(28|29|39|49|59)/;

/**
 * Bilan simplifié à une date : chaque compte de bilan (classes 1 à 5) va à l'actif s'il est débiteur, au passif s'il est créditeur ;
 * amortissements et dépréciations viennent en déduction de l'actif ; le résultat non encore clôturé figure au passif.
 */
export async function balanceSheet(ctx: Ctx, input: { fiscalYearId: string; asOf?: Date }) {
  const { rows } = await trialBalance(ctx, { fiscalYearId: input.fiscalYearId, to: input.asOf });
  const result = rows.filter((x) => x.class >= 6).reduce((a, x) => a.minus(x.balance), d(0));
  const assets: { code: string; name: string; amount: Decimal }[] = [];
  const liabilities: { code: string; name: string; amount: Decimal }[] = [];
  for (const row of rows.filter((x) => x.class <= 5)) {
    if (CONTRA.test(row.code)) { assets.push({ code: row.code, name: `${row.name} (à déduire)`, amount: row.balance }); continue; }
    if (row.balance.gt(0)) assets.push({ code: row.code, name: row.name, amount: row.balance });
    else if (row.balance.lt(0)) liabilities.push({ code: row.code, name: row.name, amount: row.balance.neg() });
  }
  if (!result.isZero()) liabilities.push({ code: "—", name: result.gt(0) ? "Résultat de l'exercice (bénéfice, avant clôture)" : "Résultat de l'exercice (perte, avant clôture)", amount: result });
  const sum = (l: { amount: Decimal }[]) => l.reduce((a, x) => a.plus(x.amount), d(0));
  return { assets, liabilities, totalAssets: sum(assets), totalLiabilities: sum(liabilities) };
}

/** Synthèse pour le tableau de bord : chiffre d'affaires, charges et résultat de l'exercice courant. */
export async function yearSummary(ctx: Ctx) {
  const fy = await defaultFiscalYear(ctx);
  if (!fy) return null;
  const is = await incomeStatement(ctx, { fiscalYearId: fy.id });
  return { fiscalYear: fy, revenue: is.totalProducts, expenses: is.totalCharges, result: is.result };
}
