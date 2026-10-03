import "server-only";
import type { ExportTable } from "@/core/export/table";
import { d, type Decimal } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import { defaultFiscalYear, incomeStatement } from "@/modules/accounting/reports";
import { siteSummary } from "@/modules/construction/service";
import { vehicleEconomics } from "@/modules/fleet/costs";
import { fineAnalytics } from "@/modules/fleet/fines";
import { canSeePay } from "@/modules/hr/employees";
import { stockValuation } from "@/modules/inventory/service";
import { projectSummary } from "@/modules/projects/service";
import { dateRange } from "./filters";
import { REPORT_MAX_ROWS, type ReportDef, type ReportFilters, type ReportResult } from "./types";

type Ctx = TenantContext;
const DAY = 86_400_000;
const num = (v: Parameters<typeof d>[0]) => d(v).toDecimalPlaces(2).toNumber();
const sum = (xs: Decimal[]) => xs.reduce((a, b) => a.plus(b), d(0));
const monthKey = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (k: string) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));
const SOLD = ["ISSUED", "PARTIALLY_PAID", "PAID"] as const;

/** Squelette de tableau ; les filtres affichés en en-tête et le sous-titre sont ajoutés par le service. */
const table = (ctx: Ctx, title: string, columns: ExportTable["columns"], rows: ExportTable["rows"], totals?: ExportTable["totals"]): ExportTable => ({
  title, company: ctx.company.tradeName ?? ctx.company.legalName, currency: ctx.company.currency, generatedAt: new Date(), columns, rows, totals,
});
const money = (ctx: Ctx, v: number) => formatMoney(v, ctx.company.currency);
const round = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

/** Mois de la plage (au plus 36), pour que les graphiques montrent aussi les mois sans activité. */
function monthsOf(f: ReportFilters, seen: string[]): string[] {
  const set = new Set(seen);
  if (f.from) {
    const end = f.to ? new Date(f.to.getTime() - DAY) : new Date();
    for (let c = new Date(Date.UTC(f.from.getUTCFullYear(), f.from.getUTCMonth(), 1)); c <= end && set.size < 36; c = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1))) set.add(monthKey(c));
  }
  return [...set].sort();
}

// ═══ Ventes ═══════════════════════════════════════════════════

const sales: ReportDef = {
  key: "ventes", title: "Ventes", description: "Factures émises sur la période, en détail ou regroupées par client.", group: "Ventes et clients",
  module: "sales", permission: "finance.invoice.read", defaultPeriod: "month",
  filters: ["period", "branch", "costCenter", "customer", "project", "user"],
  option: { key: "view", label: "Présentation", choices: [{ value: "facture", label: "Détail par facture" }, { value: "client", label: "Regroupé par client" }] },
  async run(ctx, f) {
    const list = await ctx.db.invoice.findMany({
      where: { status: { in: [...SOLD] }, issueDate: dateRange(f), branchId: f.branchId, costCenterId: f.costCenterId, customerId: f.customerId, projectId: f.projectId, createdById: f.userId },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }], take: REPORT_MAX_ROWS + 1,
      select: { number: true, issueDate: true, customerId: true, subtotal: true, discountTotal: true, taxTotal: true, total: true, amountPaid: true, creditedAmount: true, status: true, customer: { select: { name: true } } },
    });
    const truncated = list.length > REPORT_MAX_ROWS;
    const inv = list.slice(0, REPORT_MAX_ROWS);
    const ht = (i: (typeof inv)[number]) => d(i.subtotal).minus(i.discountTotal);
    const bal = (i: (typeof inv)[number]) => d(i.total).minus(i.amountPaid).minus(i.creditedAmount);
    const totals = { ht: num(sum(inv.map(ht))), tva: num(sum(inv.map((i) => d(i.taxTotal)))), ttc: num(sum(inv.map((i) => d(i.total)))), paid: num(sum(inv.map((i) => d(i.amountPaid)))), balance: num(sum(inv.map(bal))) };
    const status: Record<string, string> = { ISSUED: "Émise", PARTIALLY_PAID: "Partiellement payée", PAID: "Payée" };
    let t: ExportTable;
    if (f.view === "client") {
      const by = new Map<string, { name: string; count: number; ht: Decimal; tva: Decimal; ttc: Decimal; paid: Decimal; balance: Decimal }>();
      for (const i of inv) {
        const g = by.get(i.customerId) ?? { name: i.customer.name, count: 0, ht: d(0), tva: d(0), ttc: d(0), paid: d(0), balance: d(0) };
        g.count++; g.ht = g.ht.plus(ht(i)); g.tva = g.tva.plus(i.taxTotal); g.ttc = g.ttc.plus(i.total); g.paid = g.paid.plus(i.amountPaid); g.balance = g.balance.plus(bal(i));
        by.set(i.customerId, g);
      }
      t = table(ctx, "Ventes par client", [
        { key: "customer", label: "Client", width: 28 }, { key: "count", label: "Factures", type: "number", width: 8 }, { key: "ht", label: "Montant HT", type: "money" }, { key: "tva", label: "TVA", type: "money" },
        { key: "ttc", label: "Montant TTC", type: "money" }, { key: "paid", label: "Encaissé", type: "money" }, { key: "balance", label: "Reste dû", type: "money" },
      ], [...by.values()].sort((a, b) => b.ht.comparedTo(a.ht)).map((g) => ({ customer: g.name, count: g.count, ht: num(g.ht), tva: num(g.tva), ttc: num(g.ttc), paid: num(g.paid), balance: num(g.balance) })), { count: inv.length, ...totals });
    } else {
      t = table(ctx, "Ventes — détail des factures", [
        { key: "date", label: "Date", type: "date", width: 11 }, { key: "number", label: "N°", width: 14 }, { key: "customer", label: "Client", width: 26 }, { key: "ht", label: "HT", type: "money" }, { key: "tva", label: "TVA", type: "money" },
        { key: "ttc", label: "TTC", type: "money" }, { key: "paid", label: "Encaissé", type: "money" }, { key: "balance", label: "Reste dû", type: "money" }, { key: "status", label: "Statut", width: 14 },
      ], inv.map((i) => ({ date: i.issueDate, number: i.number, customer: i.customer.name, ht: num(ht(i)), tva: num(i.taxTotal), ttc: num(i.total), paid: num(i.amountPaid), balance: num(bal(i)), status: status[i.status] ?? i.status })), totals);
    }
    return { table: t, truncated, summary: [{ label: "Factures", value: String(inv.length) }, { label: "Montant HT", value: money(ctx, totals.ht) }, { label: "Encaissé", value: money(ctx, totals.paid) }, { label: "Reste dû", value: money(ctx, totals.balance) }] };
  },
};

// ═══ Chiffre d'affaires ═══════════════════════════════════════

const revenue: ReportDef = {
  key: "chiffre-affaires", title: "Chiffre d'affaires", description: "Chiffre d'affaires hors taxes facturé, mois par mois.", group: "Ventes et clients",
  module: "sales", permission: "finance.invoice.read", defaultPeriod: "year",
  filters: ["period", "branch", "costCenter", "customer", "project"],
  async run(ctx, f) {
    const inv = await ctx.db.invoice.findMany({
      where: { status: { in: [...SOLD] }, issueDate: dateRange(f), branchId: f.branchId, costCenterId: f.costCenterId, customerId: f.customerId, projectId: f.projectId },
      select: { issueDate: true, subtotal: true, discountTotal: true, taxTotal: true, total: true, creditedAmount: true }, take: 50_000,
    });
    const by = new Map<string, { count: number; ht: Decimal; tva: Decimal; ttc: Decimal; credited: Decimal }>();
    for (const i of inv) {
      const k = monthKey(i.issueDate);
      const g = by.get(k) ?? { count: 0, ht: d(0), tva: d(0), ttc: d(0), credited: d(0) };
      g.count++; g.ht = g.ht.plus(d(i.subtotal).minus(i.discountTotal)); g.tva = g.tva.plus(i.taxTotal); g.ttc = g.ttc.plus(i.total); g.credited = g.credited.plus(i.creditedAmount);
      by.set(k, g);
    }
    const months = monthsOf(f, [...by.keys()]);
    const rows = months.map((k) => { const g = by.get(k); return { month: monthLabel(k), count: g?.count ?? 0, ht: num(g?.ht ?? 0), tva: num(g?.tva ?? 0), ttc: num(g?.ttc ?? 0), credited: num(g?.credited ?? 0) }; });
    const total = { count: rows.reduce((a, r) => a + r.count, 0), ht: num(sum(rows.map((r) => d(r.ht)))), tva: num(sum(rows.map((r) => d(r.tva)))), ttc: num(sum(rows.map((r) => d(r.ttc)))), credited: num(sum(rows.map((r) => d(r.credited)))) };
    const t = table(ctx, "Chiffre d'affaires par mois", [
      { key: "month", label: "Mois", width: 18 }, { key: "count", label: "Factures", type: "number", width: 8 }, { key: "ht", label: "CA HT", type: "money" }, { key: "tva", label: "TVA", type: "money" }, { key: "ttc", label: "CA TTC", type: "money" }, { key: "credited", label: "Avoirs TTC", type: "money" },
    ], rows, total);
    return {
      table: t, chart: { seriesLabel: "CA HT", data: months.map((k, i) => ({ month: k, value: rows[i]!.ht })) },
      summary: [{ label: "CA HT", value: money(ctx, total.ht) }, { label: "Factures", value: String(total.count) }, { label: "Facture moyenne HT", value: money(ctx, total.count ? Math.round(total.ht / total.count) : 0) }, { label: "Avoirs TTC", value: money(ctx, total.credited) }],
    };
  },
};

// ═══ Dépenses ═════════════════════════════════════════════════

const expenses: ReportDef = {
  key: "depenses", title: "Dépenses", description: "Dépenses payées, par catégorie ou en détail.", group: "Finance et comptabilité",
  module: "finance", permission: "finance.expense.read", defaultPeriod: "month",
  filters: ["period", "branch", "costCenter", "project", "supplier", "user"],
  option: { key: "view", label: "Présentation", choices: [{ value: "categorie", label: "Par catégorie" }, { value: "detail", label: "Détail des dépenses" }] },
  async run(ctx, f) {
    const list = await ctx.db.expense.findMany({
      where: { status: "PAID", date: dateRange(f), branchId: f.branchId, costCenterId: f.costCenterId, projectId: f.projectId, supplierId: f.supplierId, createdById: f.userId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: REPORT_MAX_ROWS + 1,
      select: { number: true, date: true, description: true, amount: true, method: true, category: { select: { name: true } }, supplier: { select: { name: true } } },
    });
    const truncated = list.length > REPORT_MAX_ROWS;
    const ex = list.slice(0, REPORT_MAX_ROWS);
    const total = sum(ex.map((e) => d(e.amount)));
    const byMonth = new Map<string, Decimal>();
    for (const e of ex) byMonth.set(monthKey(e.date), (byMonth.get(monthKey(e.date)) ?? d(0)).plus(e.amount));
    const months = monthsOf(f, [...byMonth.keys()]);
    const methods: Record<string, string> = { CASH: "Espèces", BANK_TRANSFER: "Virement", CHEQUE: "Chèque", MOBILE_MONEY: "Mobile money", CARD: "Carte", OTHER: "Autre" };
    let t: ExportTable;
    if (f.view === "detail") {
      t = table(ctx, "Dépenses — détail", [
        { key: "date", label: "Date", type: "date", width: 11 }, { key: "number", label: "N°", width: 13 }, { key: "category", label: "Catégorie", width: 18 }, { key: "supplier", label: "Fournisseur", width: 18 },
        { key: "description", label: "Libellé", width: 32 }, { key: "method", label: "Mode", width: 12 }, { key: "amount", label: "Montant", type: "money" },
      ], ex.map((e) => ({ date: e.date, number: e.number, category: e.category.name, supplier: e.supplier?.name ?? "", description: e.description, method: methods[e.method] ?? e.method, amount: num(e.amount) })), { amount: num(total) });
    } else {
      const by = new Map<string, { count: number; amount: Decimal }>();
      for (const e of ex) { const g = by.get(e.category.name) ?? { count: 0, amount: d(0) }; g.count++; g.amount = g.amount.plus(e.amount); by.set(e.category.name, g); }
      t = table(ctx, "Dépenses par catégorie", [
        { key: "category", label: "Catégorie", width: 30 }, { key: "count", label: "Dépenses", type: "number", width: 10 }, { key: "amount", label: "Montant", type: "money" }, { key: "share", label: "Part", type: "percent", width: 10 },
      ], [...by.entries()].sort((a, b) => b[1].amount.comparedTo(a[1].amount)).map(([name, g]) => ({ category: name, count: g.count, amount: num(g.amount), share: pct(num(g.amount), num(total)) })), { count: ex.length, amount: num(total), share: 100 });
    }
    return { table: t, truncated, chart: { seriesLabel: "Dépenses payées", data: months.map((k) => ({ month: k, value: num(byMonth.get(k) ?? 0) })) }, summary: [{ label: "Total payé", value: money(ctx, num(total)) }, { label: "Dépenses", value: String(ex.length) }, { label: "Moyenne", value: money(ctx, ex.length ? Math.round(num(total) / ex.length) : 0) }] };
  },
};

// ═══ Résultat ═════════════════════════════════════════════════

const result: ReportDef = {
  key: "resultat", title: "Résultat", description: "Compte de résultat simplifié d'après les écritures comptables validées.", group: "Finance et comptabilité",
  module: "accounting", permission: "accounting.ledger.read", defaultPeriod: "year", filters: ["period"],
  async run(ctx, f) {
    const fy = await defaultFiscalYear(ctx);
    if (!fy) return { table: table(ctx, "Résultat", [{ key: "label", label: "Libellé" }], []), summary: [{ label: "Exercice", value: "Aucun exercice comptable" }] };
    const stmt = await incomeStatement(ctx, { fiscalYearId: fy.id, from: f.from, to: f.to ? new Date(f.to.getTime() - DAY) : undefined });
    const rows: ExportTable["rows"] = [];
    const block = (title: string, groups: typeof stmt.products) => {
      rows.push({ code: "", label: title, amount: null, bold: true });
      for (const g of groups) { rows.push({ code: g.key, label: g.label, amount: num(g.total) }); for (const r of g.rows) rows.push({ code: r.code, label: `   ${r.name}`, amount: num(r.amount) }); }
    };
    block("PRODUITS", stmt.products);
    block("CHARGES", stmt.charges);
    if (!stmt.hao.isZero()) rows.push({ code: "8", label: "Résultat hors activités ordinaires", amount: num(stmt.hao) });
    const t = table(ctx, `Compte de résultat — exercice ${fy.name ?? ""}`.trim(), [{ key: "code", label: "Compte", width: 8 }, { key: "label", label: "Libellé", width: 50 }, { key: "amount", label: "Montant", type: "money" }], rows.map(({ bold, ...r }) => { void bold; return r; }), { amount: num(stmt.result) });
    t.subtitle = "résultat = produits − charges (+ hors activités ordinaires)";
    return { table: t, summary: [{ label: "Produits", value: money(ctx, num(stmt.totalProducts)) }, { label: "Charges", value: money(ctx, num(stmt.totalCharges)) }, { label: "Résultat", value: money(ctx, num(stmt.result)) }] };
  },
};

// ═══ Trésorerie ═══════════════════════════════════════════════

const treasury: ReportDef = {
  key: "tresorerie", title: "Trésorerie", description: "Soldes d'ouverture et de clôture, encaissements et décaissements par compte.", group: "Finance et comptabilité",
  module: "finance", permission: "finance.account.read", defaultPeriod: "month", filters: ["period"],
  async run(ctx, f) {
    const accounts = await ctx.db.financeAccount.findMany({ where: { deletedAt: null }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, openingBalance: true } });
    const tx = await ctx.db.financialTransaction.groupBy({ by: ["accountId", "type"], where: { status: "VALID", date: { ...(f.to ? { lt: f.to } : {}) } }, _sum: { amount: true } });
    const before = f.from ? await ctx.db.financialTransaction.groupBy({ by: ["accountId", "type"], where: { status: "VALID", date: { lt: f.from } }, _sum: { amount: true } }) : [];
    const pick = (rows: typeof tx, accountId: string, type: "IN" | "OUT") => d(rows.find((r) => r.accountId === accountId && r.type === type)?._sum.amount ?? 0);
    const kinds: Record<string, string> = { CASH: "Caisse", BANK: "Banque", MOBILE_MONEY: "Mobile money" };
    const rows = accounts.map((a) => {
      const openingNet = pick(before, a.id, "IN").minus(pick(before, a.id, "OUT"));
      const upTo = pick(tx, a.id, "IN").minus(pick(tx, a.id, "OUT"));
      const opening = d(a.openingBalance).plus(openingNet);
      const closing = d(a.openingBalance).plus(upTo);
      const inflow = pick(tx, a.id, "IN").minus(pick(before, a.id, "IN"));
      const outflow = pick(tx, a.id, "OUT").minus(pick(before, a.id, "OUT"));
      return { account: a.name, kind: kinds[a.type] ?? a.type, opening: num(opening), inflow: num(inflow), outflow: num(outflow), closing: num(closing) };
    });
    const totals = { opening: num(sum(rows.map((r) => d(r.opening)))), inflow: num(sum(rows.map((r) => d(r.inflow)))), outflow: num(sum(rows.map((r) => d(r.outflow)))), closing: num(sum(rows.map((r) => d(r.closing)))) };
    return {
      table: table(ctx, "Trésorerie par compte", [{ key: "account", label: "Compte", width: 26 }, { key: "kind", label: "Type", width: 12 }, { key: "opening", label: "Solde d'ouverture", type: "money" }, { key: "inflow", label: "Encaissements", type: "money" }, { key: "outflow", label: "Décaissements", type: "money" }, { key: "closing", label: "Solde de clôture", type: "money" }], rows, totals),
      summary: [{ label: "Trésorerie à la clôture", value: money(ctx, totals.closing) }, { label: "Encaissements", value: money(ctx, totals.inflow) }, { label: "Décaissements", value: money(ctx, totals.outflow) }, { label: "Variation", value: money(ctx, totals.inflow - totals.outflow) }],
    };
  },
};

// ═══ Créances clients / dettes fournisseurs (balance âgée) ════

const BUCKETS = [{ key: "current", label: "Non échu" }, { key: "d30", label: "1 à 30 j" }, { key: "d60", label: "31 à 60 j" }, { key: "d90", label: "61 à 90 j" }, { key: "over", label: "Plus de 90 j" }] as const;
const bucketOf = (due: Date | null, today: Date) => {
  const late = due ? Math.floor((today.getTime() - due.getTime()) / DAY) : 0;
  return late <= 0 ? "current" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "over";
};
const todayUtc = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };

function agedTable(ctx: Ctx, title: string, partyLabel: string, items: { party: string; due: Date | null; balance: Decimal }[]) {
  const today = todayUtc();
  const by = new Map<string, Record<string, Decimal>>();
  for (const i of items) {
    const g = by.get(i.party) ?? Object.fromEntries(BUCKETS.map((b) => [b.key, d(0)]));
    g[bucketOf(i.due, today)] = g[bucketOf(i.due, today)]!.plus(i.balance);
    by.set(i.party, g);
  }
  const rows = [...by.entries()].map(([party, g]) => ({ party, ...Object.fromEntries(BUCKETS.map((b) => [b.key, num(g[b.key]!)])), total: num(sum(BUCKETS.map((b) => g[b.key]!))) } as Record<string, string | number>)).sort((a, b) => Number(b.total) - Number(a.total));
  const totals: Record<string, number> = { total: rows.reduce((a, r) => a + Number(r.total), 0) };
  for (const b of BUCKETS) totals[b.key] = rows.reduce((a, r) => a + Number(r[b.key]), 0);
  const overdue = totals.total! - totals.current!;
  return {
    table: table(ctx, title, [{ key: "party", label: partyLabel, width: 28 }, ...BUCKETS.map((b) => ({ key: b.key, label: b.label, type: "money" as const })), { key: "total", label: "Total", type: "money" as const }], rows, totals),
    totals, overdue,
  };
}

const receivables: ReportDef = {
  key: "creances-clients", title: "Créances clients", description: "Factures impayées par client et par ancienneté de retard (situation à ce jour).", group: "Ventes et clients",
  module: "sales", permission: "finance.invoice.read", defaultPeriod: "none", filters: ["customer", "branch", "costCenter", "project"],
  async run(ctx, f) {
    const inv = await ctx.db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, customerId: f.customerId, branchId: f.branchId, costCenterId: f.costCenterId, projectId: f.projectId }, select: { dueDate: true, total: true, amountPaid: true, creditedAmount: true, customer: { select: { name: true } } }, take: 50_000 });
    const items = inv.map((i) => ({ party: i.customer.name, due: i.dueDate, balance: d(i.total).minus(i.amountPaid).minus(i.creditedAmount) })).filter((i) => i.balance.gt(0));
    const a = agedTable(ctx, "Créances clients par ancienneté", "Client", items);
    return { table: a.table, summary: [{ label: "Total à encaisser", value: money(ctx, a.totals.total!) }, { label: "Dont échu", value: money(ctx, a.overdue) }, { label: "Plus de 90 jours", value: money(ctx, a.totals.over!) }, { label: "Clients débiteurs", value: String(a.table.rows.length) }] };
  },
};

const payables: ReportDef = {
  key: "dettes-fournisseurs", title: "Dettes fournisseurs", description: "Factures fournisseur à payer par fournisseur et par ancienneté d'échéance (situation à ce jour).", group: "Achats et stocks",
  module: "purchases", permission: "purchases.bill.read", defaultPeriod: "none", filters: ["supplier", "branch", "costCenter", "project"],
  async run(ctx, f) {
    const bills = await ctx.db.supplierBill.findMany({ where: { status: { in: ["POSTED", "PARTIALLY_PAID"] }, supplierId: f.supplierId, branchId: f.branchId, costCenterId: f.costCenterId, projectId: f.projectId }, select: { dueDate: true, total: true, amountPaid: true, supplier: { select: { name: true } } }, take: 50_000 });
    const items = bills.map((b) => ({ party: b.supplier.name, due: b.dueDate, balance: d(b.total).minus(b.amountPaid) })).filter((i) => i.balance.gt(0));
    const a = agedTable(ctx, "Dettes fournisseurs par ancienneté", "Fournisseur", items);
    return { table: a.table, summary: [{ label: "Total à payer", value: money(ctx, a.totals.total!) }, { label: "Dont échu", value: money(ctx, a.overdue) }, { label: "Plus de 90 jours", value: money(ctx, a.totals.over!) }, { label: "Fournisseurs créditeurs", value: String(a.table.rows.length) }] };
  },
};

// ═══ Stocks ═══════════════════════════════════════════════════

const stock: ReportDef = {
  key: "stocks", title: "Stocks", description: "Quantités, coût moyen, valeur et alertes de seuil par produit (situation à ce jour).", group: "Achats et stocks",
  module: "inventory", permission: "inventory.stock.read", defaultPeriod: "none", filters: [],
  async run(ctx) {
    const [val, products] = await Promise.all([stockValuation(ctx), ctx.db.product.findMany({ where: { deletedAt: null, trackStock: true }, select: { id: true, minStock: true } })]);
    const min = new Map(products.map((p) => [p.id, d(p.minStock)]));
    const rows = val.lines.map((l) => { const m = min.get(l.id) ?? d(0); return { sku: l.sku, name: l.name, unit: l.unit, quantity: l.quantity.toNumber(), cost: num(l.cost), value: num(l.value), minStock: m.toNumber(), alert: m.gt(0) && l.quantity.lte(m) ? "Sous le seuil" : "" }; });
    const low = rows.filter((r) => r.alert).length;
    return {
      table: table(ctx, "Valorisation des stocks", [{ key: "sku", label: "Référence", width: 12 }, { key: "name", label: "Produit", width: 30 }, { key: "unit", label: "Unité", width: 8 }, { key: "quantity", label: "Quantité", type: "number" }, { key: "cost", label: "Coût moyen", type: "money" }, { key: "value", label: "Valeur", type: "money" }, { key: "minStock", label: "Seuil", type: "number" }, { key: "alert", label: "Alerte", width: 12 }], rows, { value: num(val.total) }),
      summary: [{ label: "Valeur du stock", value: money(ctx, num(val.total)) }, { label: "Produits en stock", value: String(rows.length) }, { label: "Sous le seuil", value: String(low) }],
    };
  },
};

// ═══ RH ═══════════════════════════════════════════════════════

const hr: ReportDef = {
  key: "rh", title: "Ressources humaines", description: "Effectifs, mouvements, congés et présences par département.", group: "Ressources humaines",
  module: "hr", permission: "hr.employee.read", defaultPeriod: "month", filters: ["period", "branch", "department"],
  async run(ctx, f) {
    const pay = canSeePay(ctx);
    const emps = await ctx.db.employee.findMany({ where: { deletedAt: null, branchId: f.branchId, departmentId: f.departmentId }, select: { id: true, status: true, departmentId: true, hireDate: true, endDate: true, baseSalary: true, department: { select: { name: true } } }, take: 20_000 });
    const ids = emps.map((e) => e.id);
    const range = dateRange(f);
    const [leaves, att] = await Promise.all([
      ctx.can("hr.leave.read") ? ctx.db.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", startDate: range }, select: { employeeId: true, days: true } }) : Promise.resolve(null),
      ctx.can("hr.attendance.read") ? ctx.db.attendance.groupBy({ by: ["employeeId", "status"], where: { employeeId: { in: ids }, date: range, status: { in: ["ABSENT", "LATE"] } }, _count: { _all: true } }) : Promise.resolve(null),
    ]);
    const dept = new Map(emps.map((e) => [e.id, e.department?.name ?? "Sans département"]));
    const by = new Map<string, { active: number; hired: number; left: number; leave: Decimal; absent: number; late: number; payroll: Decimal }>();
    const g = (name: string) => { if (!by.has(name)) by.set(name, { active: 0, hired: 0, left: 0, leave: d(0), absent: 0, late: 0, payroll: d(0) }); return by.get(name)!; };
    const inRange = (dt: Date | null) => dt !== null && (!f.from || dt >= f.from) && (!f.to || dt < f.to);
    for (const e of emps) {
      const x = g(e.department?.name ?? "Sans département");
      if (e.status === "ACTIVE") { x.active++; x.payroll = x.payroll.plus(e.baseSalary); }
      if (inRange(e.hireDate)) x.hired++;
      if (e.status === "TERMINATED" && inRange(e.endDate)) x.left++;
    }
    for (const l of leaves ?? []) { const x = g(dept.get(l.employeeId)!); x.leave = x.leave.plus(l.days); }
    for (const a of att ?? []) { const x = g(dept.get(a.employeeId)!); if (a.status === "ABSENT") x.absent += a._count._all; else x.late += a._count._all; }
    const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([name, x]) => ({ department: name, active: x.active, hired: x.hired, left: x.left, ...(leaves ? { leave: x.leave.toNumber() } : {}), ...(att ? { absent: x.absent, late: x.late } : {}), ...(pay ? { payroll: num(x.payroll) } : {}) } as Record<string, string | number>));
    const sumKey = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    const columns: ExportTable["columns"] = [{ key: "department", label: "Département", width: 26 }, { key: "active", label: "Effectif actif", type: "number" }, { key: "hired", label: "Entrées", type: "number" }, { key: "left", label: "Sorties", type: "number" }];
    const totals: Record<string, number> = { active: sumKey("active"), hired: sumKey("hired"), left: sumKey("left") };
    if (leaves) { columns.push({ key: "leave", label: "Jours de congé", type: "number" }); totals.leave = sumKey("leave"); }
    if (att) { columns.push({ key: "absent", label: "Absences", type: "number" }, { key: "late", label: "Retards", type: "number" }); totals.absent = sumKey("absent"); totals.late = sumKey("late"); }
    if (pay) { columns.push({ key: "payroll", label: "Masse salariale de base", type: "money" }); totals.payroll = sumKey("payroll"); }
    const summary = [{ label: "Effectif actif", value: String(totals.active) }, { label: "Entrées", value: String(totals.hired) }, { label: "Sorties", value: String(totals.left) }];
    if (leaves) summary.push({ label: "Jours de congé", value: String(totals.leave) });
    return { table: table(ctx, "Ressources humaines par département", columns, rows, totals), summary };
  },
};

// ═══ Projets ══════════════════════════════════════════════════

const projects: ReportDef = {
  key: "projets", title: "Projets", description: "Budget, temps, coûts, facturation et marge de chaque projet (cumul à ce jour).", group: "Projets",
  module: "projects", permission: "project.project.read", defaultPeriod: "none", filters: ["customer", "project", "branch", "costCenter"],
  async run(ctx, f) {
    const list = await ctx.db.project.findMany({
      where: { deletedAt: null, status: { not: "CANCELLED" }, customerId: f.customerId, id: f.projectId, branchId: f.branchId, costCenterId: f.costCenterId },
      orderBy: { code: "asc" }, take: 200, select: { id: true, code: true, name: true, status: true, customer: { select: { name: true } } },
    });
    const status: Record<string, string> = { PLANNED: "Planifié", ACTIVE: "En cours", ON_HOLD: "En pause", DONE: "Terminé" };
    const rows = [];
    for (const p of list) {
      const s = await projectSummary(ctx, p.id);
      rows.push({ code: p.code, name: p.name, customer: p.customer?.name ?? "", status: status[p.status] ?? p.status, budget: num(s.budget), hours: s.hours.toNumber(), cost: num(s.totalCost), revenue: num(s.revenue), margin: num(s.margin), used: s.budgetUsedPct ?? 0 });
    }
    const tot = { budget: rows.reduce((a, r) => a + r.budget, 0), hours: rows.reduce((a, r) => a + r.hours, 0), cost: rows.reduce((a, r) => a + r.cost, 0), revenue: rows.reduce((a, r) => a + r.revenue, 0), margin: rows.reduce((a, r) => a + r.margin, 0) };
    return {
      table: table(ctx, "Rentabilité des projets", [{ key: "code", label: "Code", width: 9 }, { key: "name", label: "Projet", width: 26 }, { key: "customer", label: "Client", width: 18 }, { key: "status", label: "Statut", width: 10 }, { key: "budget", label: "Budget", type: "money" }, { key: "hours", label: "Heures", type: "number" }, { key: "cost", label: "Coût total", type: "money" }, { key: "revenue", label: "Facturé HT", type: "money" }, { key: "margin", label: "Marge", type: "money" }, { key: "used", label: "Budget consommé", type: "percent" }], rows, tot),
      summary: [{ label: "Projets", value: String(rows.length) }, { label: "Budget total", value: money(ctx, tot.budget) }, { label: "Coût total", value: money(ctx, tot.cost) }, { label: "Marge", value: money(ctx, tot.margin) }],
    };
  },
};

// ═══ Commercial ═══════════════════════════════════════════════

const commercial: ReportDef = {
  key: "commercial", title: "Performance commerciale", description: "Opportunités créées, gagnées et perdues par commercial, et pipeline ouvert.", group: "Ventes et clients",
  module: "crm", permission: "crm.opportunity.read", defaultPeriod: "month", filters: ["period", "user", "customer"],
  async run(ctx, f) {
    const range = dateRange(f);
    const base = { deletedAt: null, ownerId: f.userId, customerId: f.customerId };
    const [created, closed, open, owners] = await Promise.all([
      ctx.db.opportunity.groupBy({ by: ["ownerId"], where: { ...base, createdAt: range }, _count: { _all: true } }),
      ctx.db.opportunity.groupBy({ by: ["ownerId", "status"], where: { ...base, status: { in: ["WON", "LOST"] }, closedAt: range }, _count: { _all: true }, _sum: { amount: true } }),
      ctx.db.opportunity.groupBy({ by: ["ownerId"], where: { ...base, status: "OPEN" }, _count: { _all: true }, _sum: { amount: true } }),
      ctx.db.companyMembership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, user: { select: { name: true } } } }),
    ]);
    const name = new Map(owners.map((o) => [o.userId, o.user.name]));
    const ids = new Set<string | null>([...created, ...closed, ...open].map((x) => x.ownerId));
    const rows = [...ids].map((id) => {
      const won = closed.find((c) => c.ownerId === id && c.status === "WON"), lost = closed.find((c) => c.ownerId === id && c.status === "LOST"), op = open.find((o) => o.ownerId === id);
      const nWon = won?._count._all ?? 0, nLost = lost?._count._all ?? 0;
      return { owner: id ? name.get(id) ?? "Utilisateur retiré" : "Non attribué", created: created.find((c) => c.ownerId === id)?._count._all ?? 0, won: nWon, lost: nLost, rate: pct(nWon, nWon + nLost), wonAmount: num(won?._sum.amount ?? 0), openCount: op?._count._all ?? 0, openAmount: num(op?._sum.amount ?? 0) };
    }).sort((a, b) => b.wonAmount - a.wonAmount || a.owner.localeCompare(b.owner, "fr"));
    const tot = { created: rows.reduce((a, r) => a + r.created, 0), won: rows.reduce((a, r) => a + r.won, 0), lost: rows.reduce((a, r) => a + r.lost, 0), wonAmount: rows.reduce((a, r) => a + r.wonAmount, 0), openCount: rows.reduce((a, r) => a + r.openCount, 0), openAmount: rows.reduce((a, r) => a + r.openAmount, 0) };
    const rate = pct(tot.won, tot.won + tot.lost);
    return {
      table: table(ctx, "Performance commerciale", [{ key: "owner", label: "Commercial", width: 24 }, { key: "created", label: "Créées", type: "number" }, { key: "won", label: "Gagnées", type: "number" }, { key: "lost", label: "Perdues", type: "number" }, { key: "rate", label: "Taux de réussite", type: "percent" }, { key: "wonAmount", label: "Montant gagné", type: "money" }, { key: "openCount", label: "Ouvertes", type: "number" }, { key: "openAmount", label: "Pipeline ouvert", type: "money" }], rows, { ...tot, rate }),
      summary: [{ label: "Montant gagné", value: money(ctx, tot.wonAmount) }, { label: "Taux de réussite", value: `${rate} %` }, { label: "Pipeline ouvert", value: money(ctx, tot.openAmount) }, { label: "Opportunités gagnées", value: String(tot.won) }],
    };
  },
};

// ═══ Flotte, contraventions, chantiers ════════════════════════

const fleet: ReportDef = {
  key: "flotte", title: "Coûts et rentabilité de la flotte", description: "Par véhicule : missions, kilomètres, produit, carburant, entretiens, assurances, contraventions, marge et coût au kilomètre.", group: "Flotte et chantiers",
  module: "fleet", permission: "fleet.vehicle.read", defaultPeriod: "year", filters: ["period", "branch", "costCenter"],
  async run(ctx, f) {
    const eco = await vehicleEconomics(ctx, { from: f.from, to: f.to, branchId: f.branchId, costCenterId: f.costCenterId });
    const sumOf = (k: "revenue" | "fuel" | "maintenance" | "compliance" | "fines" | "cost" | "margin" | "km" | "trips") => round(eco.reduce((a, e) => a + e[k], 0));
    const totals = { trips: sumOf("trips"), km: sumOf("km"), revenue: sumOf("revenue"), fuel: sumOf("fuel"), maintenance: sumOf("maintenance"), compliance: sumOf("compliance"), fines: sumOf("fines"), cost: sumOf("cost"), margin: sumOf("margin") };
    return {
      table: table(ctx, "Coûts et rentabilité de la flotte", [
        { key: "plate", label: "Véhicule", width: 14 }, { key: "label", label: "Modèle", width: 16 }, { key: "trips", label: "Missions", type: "number", width: 8 }, { key: "km", label: "Km", type: "number", width: 9 }, { key: "revenue", label: "Produit", type: "money" },
        { key: "fuel", label: "Carburant", type: "money" }, { key: "maintenance", label: "Entretiens", type: "money" }, { key: "compliance", label: "Assurance, visite", type: "money" }, { key: "fines", label: "Contraventions", type: "money" },
        { key: "cost", label: "Coût total", type: "money" }, { key: "margin", label: "Marge", type: "money" }, { key: "costPerKm", label: "Coût / km", type: "money" }, { key: "per100", label: "L/100 km", type: "number", width: 9 },
      ], eco.map((e) => ({ plate: e.plate, label: e.label, trips: e.trips, km: e.km, revenue: e.revenue, fuel: e.fuel, maintenance: e.maintenance, compliance: e.compliance, fines: e.fines, cost: e.cost, margin: e.margin, costPerKm: e.costPerKm, per100: e.per100 })), totals),
      summary: [{ label: "Produit", value: money(ctx, totals.revenue) }, { label: "Coûts", value: money(ctx, totals.cost) }, { label: "Marge", value: money(ctx, totals.margin) }, { label: "Kilomètres", value: totals.km.toLocaleString("fr-FR") }],
    };
  },
};

const fines: ReportDef = {
  key: "contraventions", title: "Contraventions", description: "Montants par véhicule, par chauffeur, par infraction ou en détail ; récidives sur la période.", group: "Flotte et chantiers",
  module: "fleet", permission: "fleet.fine.read", defaultPeriod: "year", filters: ["period"],
  option: { key: "view", label: "Présentation", choices: [{ value: "vehicule", label: "Par véhicule" }, { value: "chauffeur", label: "Par chauffeur" }, { value: "infraction", label: "Par infraction" }, { value: "detail", label: "Détail des PV" }] },
  async run(ctx, f) {
    const a = await fineAnalytics(ctx, { from: f.from, to: f.to });
    const statuses: Record<string, string> = { TO_PAY: "À payer", PAID: "Payée", CONTESTED: "Contestée", CANCELLED: "Annulée" };
    const group = (title: string, label: string, rows: { label: string; count: number; amount: number }[]) => table(ctx, title, [{ key: "label", label, width: 32 }, { key: "count", label: "PV", type: "number", width: 8 }, { key: "amount", label: "Montant", type: "money" }, { key: "share", label: "Part", type: "percent", width: 10 }],
      rows.map((r) => ({ label: r.label, count: r.count, amount: r.amount, share: pct(r.amount, a.total) })), { count: a.count, amount: a.total, share: 100 });
    let t: ExportTable;
    if (f.view === "chauffeur") t = group("Contraventions par chauffeur", "Chauffeur", a.byDriver);
    else if (f.view === "infraction") t = group("Contraventions par infraction", "Infraction", a.offences);
    else if (f.view === "detail") {
      const rows = await ctx.db.trafficFine.findMany({ where: { date: dateRange(f) }, orderBy: { date: "desc" }, take: REPORT_MAX_ROWS, include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } } });
      t = table(ctx, "Contraventions — détail", [{ key: "date", label: "Date", type: "date", width: 11 }, { key: "number", label: "PV", width: 14 }, { key: "vehicle", label: "Véhicule", width: 14 }, { key: "driver", label: "Chauffeur", width: 18 }, { key: "offence", label: "Infraction", width: 28 }, { key: "amount", label: "Montant", type: "money" }, { key: "status", label: "Statut", width: 11 }],
        rows.map((r) => ({ date: r.date, number: r.number, vehicle: r.vehicle.plate, driver: r.driver?.fullName ?? "", offence: r.offence, amount: num(r.amount), status: statuses[r.status] ?? r.status })), { amount: num(sum(rows.filter((r) => r.status !== "CANCELLED").map((r) => d(r.amount)))) });
    } else t = group("Contraventions par véhicule", "Véhicule", a.byVehicle);
    return { table: t, chart: { seriesLabel: "Montant des PV", data: a.monthly.map((m) => ({ month: m.month, value: m.amount })) }, summary: [{ label: "Montant (hors annulées)", value: money(ctx, a.total) }, { label: "PV", value: String(a.count) }, { label: "Chauffeurs récidivistes", value: String(a.repeatDrivers.length) }, { label: "Véhicules récidivistes", value: String(a.repeatVehicles.length) }] };
  },
};

const sites: ReportDef = {
  key: "chantiers", title: "Chantiers : budget et avancement", description: "Budget prévu, coût réel, avancement, prévision à l'avancement et marge de chaque chantier (cumul à ce jour).", group: "Flotte et chantiers",
  module: "construction", permission: "construction.site.read", defaultPeriod: "none", filters: ["customer"],
  async run(ctx, f) {
    const list = await ctx.db.constructionSite.findMany({ where: { deletedAt: null, status: { not: "CANCELLED" }, customerId: f.customerId }, orderBy: { code: "asc" }, take: 200, select: { id: true, code: true, name: true, status: true } });
    const status: Record<string, string> = { PLANNED: "Planifié", ACTIVE: "En cours", ON_HOLD: "En pause", DONE: "Terminé" };
    const rows = [];
    for (const s of list) {
      const x = await siteSummary(ctx, s.id);
      rows.push({ code: s.code, name: s.name, status: status[s.status] ?? s.status, progress: x.progress, budget: x.budgetTotal, actual: x.actualTotal, used: x.usedPct ?? 0, forecast: x.forecast, revenue: x.revenue, margin: x.margin });
    }
    const tot = { budget: round(rows.reduce((a, r) => a + r.budget, 0)), actual: round(rows.reduce((a, r) => a + r.actual, 0)), revenue: round(rows.reduce((a, r) => a + (r.revenue ?? 0), 0)), margin: round(rows.reduce((a, r) => a + (r.margin ?? 0), 0)) };
    return {
      table: table(ctx, "Chantiers : budget et avancement", [{ key: "code", label: "Code", width: 9 }, { key: "name", label: "Chantier", width: 26 }, { key: "status", label: "Statut", width: 10 }, { key: "progress", label: "Avancement", type: "percent", width: 11 }, { key: "budget", label: "Budget", type: "money" }, { key: "actual", label: "Réel", type: "money" }, { key: "used", label: "Consommé", type: "percent" }, { key: "forecast", label: "Prévision", type: "money" }, { key: "revenue", label: "Facturé HT", type: "money" }, { key: "margin", label: "Marge", type: "money" }], rows, tot),
      summary: [{ label: "Chantiers", value: String(rows.length) }, { label: "Budget", value: money(ctx, tot.budget) }, { label: "Réel", value: money(ctx, tot.actual) }, { label: "Marge", value: money(ctx, tot.margin) }],
    };
  },
};

export const REPORTS: ReportDef[] = [sales, revenue, commercial, receivables, expenses, result, treasury, payables, stock, hr, projects, fleet, fines, sites];
export const REPORT_BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

export type { ReportResult };
