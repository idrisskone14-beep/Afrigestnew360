import "server-only";
import { pendingDecisionCount } from "@/core/approvals";
import { d, num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { CONTRACT_TYPES } from "@/modules/hr/schemas";
import { formatMoney } from "@/lib/reference-data";
import { yearSummary } from "@/modules/accounting/reports";
import { monthlyCashflow } from "@/modules/finance/reports";
import { treasuryTotal } from "@/modules/finance/treasury";
import { fleetAttention } from "@/modules/fleet/costs";
import { lowStockProducts } from "@/modules/inventory/service";
import { payablesSummary } from "@/modules/purchasing/bills";

type Ctx = TenantContext;
type Tone = "danger" | "warning" | "success";

export interface ListItem { label: string; sub?: string; value?: string; href?: string; tone?: Tone }
/** Données d'un widget : toujours sérialisables (chaînes et nombres) pour traverser la frontière serveur → client. */
export type WidgetData =
  | { kind: "kpi"; value: string; hint?: string; tone?: Tone; href?: string }
  | { kind: "bars"; seriesLabel: string; data: { month: string; value: number }[] }
  | { kind: "cashflow"; data: { month: string; inflow: number; outflow: number }[] }
  | { kind: "list"; items: ListItem[]; empty: string };

export interface WidgetDef {
  key: string;
  title: string;
  icon: string;
  size: "kpi" | "half" | "wide";
  /** Module requis (actif pour l'entreprise) et permission requise : un widget non autorisé n'est ni chargé ni affiché. */
  module?: string;
  permission?: string;
  load: (ctx: Ctx) => Promise<WidgetData>;
}

const LIVE = ["ISSUED", "PARTIALLY_PAID", "PAID"] as const;
const utc = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const monthStart = (offset = 0) => { const n = new Date(); return utc(n.getUTCFullYear(), n.getUTCMonth() + offset); };

async function invoicedNet(ctx: Ctx, from: Date, to: Date) {
  const a = await ctx.db.invoice.aggregate({ where: { status: { in: [...LIVE] }, issueDate: { gte: from, lt: to } }, _sum: { subtotal: true, discountTotal: true } });
  return d(a._sum.subtotal ?? 0).minus(a._sum.discountTotal ?? 0);
}

async function openInvoices(ctx: Ctx) {
  const rows = await ctx.db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { id: true, number: true, dueDate: true, total: true, amountPaid: true, creditedAmount: true, customer: { select: { name: true } } } });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return rows.map((i) => ({ ...i, balance: d(i.total).minus(i.amountPaid).minus(i.creditedAmount), overdue: i.dueDate !== null && i.dueDate < today })).filter((i) => i.balance.gt(0));
}

/** Contrats à durée déterminée dont la fin tombe dans les `days` prochains jours, pour des salariés encore actifs. */
async function endingContracts(ctx: Ctx, days: number, take: number) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const limit = new Date(today.getTime() + days * 86_400_000);
  return ctx.db.employmentContract.findMany({ where: { endDate: { gte: today, lte: limit }, employee: { status: "ACTIVE", deletedAt: null } }, orderBy: { endDate: "asc" }, take, select: { id: true, type: true, endDate: true, employee: { select: { id: true, firstName: true, lastName: true } } } });
}

export const WIDGETS: WidgetDef[] = [
  {
    key: "alerts", title: "Alertes", icon: "AlertTriangle", size: "half",
    async load(ctx) {
      const items: ListItem[] = [];
      if (ctx.hasModule("sales") && ctx.can("finance.invoice.read")) {
        const od = (await openInvoices(ctx)).filter((i) => i.overdue);
        if (od.length) items.push({ label: `${od.length} facture${od.length > 1 ? "s" : ""} client en retard`, value: formatMoney(od.reduce((a, i) => a + i.balance.toNumber(), 0), ctx.company.currency), href: "/app/sales/relances", tone: "danger" });
      }
      if (ctx.hasModule("purchases") && ctx.can("purchases.bill.read")) {
        const p = await payablesSummary(ctx);
        if (p.overdue.gt(0)) items.push({ label: "Dettes fournisseurs échues", value: formatMoney(p.overdue.toNumber(), ctx.company.currency), href: "/app/purchases/factures?statut=OVERDUE", tone: "danger" });
      }
      if (ctx.hasModule("inventory") && ctx.can("inventory.stock.read")) {
        const low = await lowStockProducts(ctx, 50);
        if (low.length) items.push({ label: `${low.length} produit${low.length > 1 ? "s" : ""} sous le seuil de stock`, href: "/app/inventory", tone: "warning" });
      }
      const pending = await pendingDecisionCount(ctx);
      if (pending) items.push({ label: `${pending} demande${pending > 1 ? "s" : ""} à valider`, href: "/app/validations", tone: "warning" });
      if (ctx.hasModule("hr") && ctx.can("hr.leave.approve")) {
        const leaves = await ctx.db.leaveRequest.count({ where: { status: "PENDING" } });
        if (leaves) items.push({ label: `${leaves} demande${leaves > 1 ? "s" : ""} de congé en attente`, href: "/app/hr/conges?statut=PENDING", tone: "warning" });
      }
      if (ctx.hasModule("hr") && ctx.can("hr.contract.manage")) {
        const ending = await endingContracts(ctx, 30, 50);
        if (ending.length) items.push({ label: `${ending.length} contrat${ending.length > 1 ? "s" : ""} arrivant à échéance sous 30 jours`, href: "/app/hr/salaries", tone: "warning" });
      }
      if (ctx.hasModule("fleet") && ctx.can("fleet.vehicle.read")) {
        const urgent = (await fleetAttention(ctx.db, ctx.company.id)).filter((i) => i.severity === "danger");
        if (urgent.length) items.push({ label: `${urgent.length} point${urgent.length > 1 ? "s" : ""} urgent${urgent.length > 1 ? "s" : ""} dans la flotte (assurance, visite, entretien, PV…)`, href: "/app/fleet", tone: "danger" });
      }
      if (ctx.hasModule("accounting") && ctx.can("accounting.entry.read")) {
        const drafts = await ctx.db.journalEntry.count({ where: { status: "DRAFT" } });
        if (drafts) items.push({ label: `${drafts} écriture${drafts > 1 ? "s" : ""} comptable${drafts > 1 ? "s" : ""} en brouillon`, href: "/app/accounting/ecritures?statut=DRAFT" });
      }
      return { kind: "list", items, empty: "Aucune alerte : tout est à jour." };
    },
  },
  {
    key: "revenue", title: "Chiffre d'affaires du mois", icon: "TrendingUp", size: "kpi", module: "sales", permission: "finance.invoice.read",
    async load(ctx) {
      const [cur, prev] = await Promise.all([invoicedNet(ctx, monthStart(0), monthStart(1)), invoicedNet(ctx, monthStart(-1), monthStart(0))]);
      const delta = prev.gt(0) ? cur.minus(prev).div(prev).mul(100).round().toNumber() : null;
      return { kind: "kpi", value: formatMoney(cur.toNumber(), ctx.company.currency), hint: delta === null ? "HT, factures émises" : `${delta >= 0 ? "+" : ""}${delta} % vs mois précédent (HT)`, tone: delta !== null && delta < 0 ? "warning" : undefined, href: "/app/sales/factures" };
    },
  },
  {
    key: "cash", title: "Trésorerie", icon: "Landmark", size: "kpi", module: "finance", permission: "finance.account.read",
    async load(ctx) {
      const total = await treasuryTotal(ctx);
      const accounts = await ctx.db.financeAccount.count({ where: { deletedAt: null, isActive: true } });
      return { kind: "kpi", value: formatMoney(total.toNumber(), ctx.company.currency), hint: `${accounts} compte${accounts > 1 ? "s" : ""} (banque, caisse, mobile money)`, tone: total.lt(0) ? "danger" : undefined, href: "/app/finance/comptes" };
    },
  },
  {
    key: "receivables", title: "À encaisser", icon: "HandCoins", size: "kpi", module: "sales", permission: "finance.invoice.read",
    async load(ctx) {
      const open = await openInvoices(ctx);
      const total = open.reduce((a, i) => a.plus(i.balance), d(0));
      const od = open.filter((i) => i.overdue);
      const odTotal = od.reduce((a, i) => a.plus(i.balance), d(0));
      return { kind: "kpi", value: formatMoney(total.toNumber(), ctx.company.currency), hint: od.length ? `dont ${formatMoney(odTotal.toNumber(), ctx.company.currency)} échu (${od.length})` : `${open.length} facture${open.length > 1 ? "s" : ""} ouverte${open.length > 1 ? "s" : ""}`, tone: od.length ? "danger" : undefined, href: "/app/sales/relances" };
    },
  },
  {
    key: "payables", title: "À payer", icon: "Wallet", size: "kpi", module: "purchases", permission: "purchases.bill.read",
    async load(ctx) {
      const p = await payablesSummary(ctx);
      return { kind: "kpi", value: formatMoney(p.outstanding.toNumber(), ctx.company.currency), hint: p.overdue.gt(0) ? `dont ${formatMoney(p.overdue.toNumber(), ctx.company.currency)} échu` : `${p.count} facture${p.count > 1 ? "s" : ""} fournisseur`, tone: p.overdue.gt(0) ? "danger" : undefined, href: "/app/purchases/factures" };
    },
  },
  {
    key: "result", title: "Résultat de l'exercice", icon: "BookOpenCheck", size: "kpi", module: "accounting", permission: "accounting.ledger.read",
    async load(ctx) {
      const s = await yearSummary(ctx);
      if (!s) return { kind: "kpi", value: "—", hint: "Aucun exercice ouvert" };
      const cur = ctx.company.currency;
      return { kind: "kpi", value: formatMoney(s.result.toNumber(), cur), hint: `Produits ${formatMoney(s.revenue.toNumber(), cur)} · charges ${formatMoney(s.expenses.toNumber(), cur)}`, tone: s.result.lt(0) ? "danger" : "success", href: "/app/accounting/etats" };
    },
  },
  {
    key: "customers", title: "Nouveaux clients (30 jours)", icon: "Users", size: "kpi", module: "crm", permission: "crm.customer.read",
    async load(ctx) {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [recent, total] = await Promise.all([ctx.db.customer.count({ where: { deletedAt: null, createdAt: { gte: since } } }), ctx.db.customer.count({ where: { deletedAt: null, isActive: true } })]);
      return { kind: "kpi", value: String(recent), hint: `${total} client${total > 1 ? "s" : ""} actif${total > 1 ? "s" : ""} au total`, href: "/app/crm/clients" };
    },
  },
  {
    key: "pipeline", title: "Opportunités ouvertes", icon: "Target", size: "kpi", module: "crm", permission: "crm.opportunity.read",
    async load(ctx) {
      const a = await ctx.db.opportunity.aggregate({ where: { status: "OPEN", deletedAt: null }, _count: true, _sum: { amount: true } });
      return { kind: "kpi", value: String(a._count), hint: `Valeur : ${formatMoney(num(a._sum.amount), ctx.company.currency)}`, href: "/app/crm/opportunites" };
    },
  },
  {
    key: "sales_chart", title: "Facturation — 6 derniers mois", icon: "BarChart3", size: "half", module: "sales", permission: "finance.invoice.read",
    async load(ctx) {
      const from = monthStart(-5);
      const rows = await ctx.tx((tx) => tx.$queryRaw<{ m: string; total: unknown }[]>`
        SELECT to_char("issueDate", 'YYYY-MM') AS m, SUM("subtotal" - "discountTotal") AS total
        FROM "Invoice" WHERE "status" IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') AND "issueDate" >= ${from} GROUP BY 1`);
      const data = Array.from({ length: 6 }, (_, i) => {
        const dt = utc(from.getUTCFullYear(), from.getUTCMonth() + i);
        const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
        return { month: key, value: Number(rows.find((r) => r.m === key)?.total ?? 0) };
      });
      return { kind: "bars", seriesLabel: "Facturé (HT)", data };
    },
  },
  {
    key: "cashflow", title: "Flux de trésorerie", icon: "ArrowLeftRight", size: "half", module: "finance", permission: "finance.account.read",
    async load(ctx) { return { kind: "cashflow", data: await monthlyCashflow(ctx, 6) }; },
  },
  {
    key: "expenses", title: "Dépenses du mois par catégorie", icon: "Receipt", size: "half", module: "finance", permission: "finance.expense.read",
    async load(ctx) {
      const groups = await ctx.db.financialTransaction.groupBy({ by: ["categoryId"], where: { type: "OUT", status: "VALID", categoryId: { not: null }, date: { gte: monthStart(0), lt: monthStart(1) } }, _sum: { amount: true } });
      const cats = await ctx.db.financeCategory.findMany({ where: { id: { in: groups.map((g) => g.categoryId!).filter(Boolean) } }, select: { id: true, name: true } });
      const names = new Map(cats.map((c) => [c.id, c.name]));
      const items = groups.map((g) => ({ label: names.get(g.categoryId!) ?? "—", amount: d(g._sum.amount ?? 0) })).sort((a, b) => b.amount.comparedTo(a.amount)).slice(0, 6)
        .map((g) => ({ label: g.label, value: formatMoney(g.amount.toNumber(), ctx.company.currency), href: "/app/finance/depenses" }));
      return { kind: "list", items, empty: "Aucune dépense ce mois-ci." };
    },
  },
  {
    key: "low_stock", title: "Stocks critiques", icon: "Boxes", size: "half", module: "inventory", permission: "inventory.stock.read",
    async load(ctx) {
      const low = await lowStockProducts(ctx, 6);
      return { kind: "list", empty: "Aucun produit sous son seuil minimum.", items: low.map((p) => ({ label: p.name, sub: `${p.sku} · seuil ${p.minStock.toNumber()} ${p.unit}`, value: `${p.quantity.minus(p.reserved).toNumber()} ${p.unit}`, href: "/app/inventory/produits", tone: "warning" as const })) };
    },
  },
  {
    key: "headcount", title: "Effectif", icon: "UsersRound", size: "kpi", module: "hr", permission: "hr.employee.read",
    async load(ctx) {
      const [active, onLeave] = await Promise.all([
        ctx.db.employee.count({ where: { deletedAt: null, status: "ACTIVE" } }),
        ctx.can("hr.leave.read") ? ctx.db.leaveRequest.count({ where: { status: "APPROVED", startDate: { lte: new Date() }, endDate: { gte: new Date(new Date().toISOString().slice(0, 10)) } } }) : Promise.resolve(null),
      ]);
      return { kind: "kpi", value: String(active), hint: onLeave === null ? "salariés actifs" : `salarié${active > 1 ? "s" : ""} actif${active > 1 ? "s" : ""} · ${onLeave} en congé aujourd'hui`, href: "/app/hr/salaries" };
    },
  },
  {
    key: "contracts_ending", title: "Contrats arrivant à échéance", icon: "CalendarClock", size: "half", module: "hr", permission: "hr.contract.manage",
    async load(ctx) {
      const rows = await endingContracts(ctx, 60, 8);
      return { kind: "list", empty: "Aucun contrat n'arrive à échéance dans les 60 jours.", items: rows.map((c) => ({ label: `${c.employee.lastName} ${c.employee.firstName}`, sub: `${CONTRACT_TYPES.find((t) => t.value === c.type)?.label ?? c.type} · fin le ${fmtDate(c.endDate)}`, href: `/app/hr/salaries/${c.employee.id}?onglet=contrats`, tone: c.endDate && c.endDate.getTime() - Date.now() < 15 * 86_400_000 ? "warning" as const : undefined })) };
    },
  },
  {
    key: "projects", title: "Projets en cours", icon: "KanbanSquare", size: "kpi", module: "projects", permission: "project.project.read",
    async load(ctx) {
      const today = new Date(new Date().toISOString().slice(0, 10));
      const [active, late, lateTasks] = await Promise.all([
        ctx.db.project.count({ where: { deletedAt: null, status: "ACTIVE" } }),
        ctx.db.project.count({ where: { deletedAt: null, status: "ACTIVE", endDate: { lt: today } } }),
        ctx.db.projectTask.count({ where: { project: { deletedAt: null, status: "ACTIVE" }, status: { not: "DONE" }, dueDate: { lt: today } } }),
      ]);
      return { kind: "kpi", value: String(active), hint: late || lateTasks ? `${late} en retard · ${lateTasks} tâche${lateTasks > 1 ? "s" : ""} en retard` : "Aucun retard", tone: late ? "warning" : undefined, href: "/app/projects" };
    },
  },
  {
    key: "fleet", title: "Flotte : à traiter", icon: "Truck", size: "half", module: "fleet", permission: "fleet.vehicle.read",
    async load(ctx) {
      const items = await fleetAttention(ctx.db, ctx.company.id);
      return { kind: "list", empty: "Assurances, visites techniques, permis et entretiens sont à jour.", items: items.slice(0, 6).map((i) => ({ label: i.label, href: i.href, tone: i.severity })) };
    },
  },
  {
    key: "sites", title: "Chantiers en cours", icon: "HardHat", size: "kpi", module: "construction", permission: "construction.site.read",
    async load(ctx) {
      const [active, avg] = await Promise.all([ctx.db.constructionSite.count({ where: { deletedAt: null, status: "ACTIVE" } }), ctx.db.constructionSite.aggregate({ where: { deletedAt: null, status: "ACTIVE" }, _avg: { progress: true } })]);
      return { kind: "kpi", value: String(active), hint: active ? `avancement moyen ${Math.round(avg._avg.progress ?? 0)} %` : "aucun chantier actif", href: "/app/construction" };
    },
  },
  {
    key: "activity", title: "Activité récente", icon: "Activity", size: "half", permission: "audit.log.read",
    async load(ctx) {
      const logs = await ctx.db.auditLog.findMany({ where: { action: { not: "document.download" } }, orderBy: { createdAt: "desc" }, take: 8, select: { summary: true, action: true, createdAt: true } });
      return { kind: "list", empty: "Aucune activité enregistrée.", items: logs.map((l) => ({ label: l.summary ?? l.action, sub: fmtDateTime(l.createdAt) })) };
    },
  },
  {
    key: "crm_activity", title: "Activités commerciales à venir", icon: "CalendarClock", size: "half", module: "crm", permission: "crm.activity.read",
    async load(ctx) {
      const rows = await ctx.db.activity.findMany({ where: { doneAt: null }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 6, include: { customer: { select: { name: true } } } });
      return { kind: "list", empty: "Aucune activité planifiée.", items: rows.map((a) => ({ label: a.subject, sub: [a.customer?.name, a.dueAt ? `échéance ${fmtDateTime(a.dueAt)}` : null].filter(Boolean).join(" · "), href: "/app/crm/activites", tone: a.dueAt && a.dueAt < new Date() ? ("danger" as const) : undefined })) };
    },
  },
];

export const WIDGET_BY_KEY = new Map(WIDGETS.map((w) => [w.key, w]));

/** Widgets que l'utilisateur peut voir : module actif ET permission détenue (vérifié ici, côté serveur). */
export const availableWidgets = (ctx: Pick<Ctx, "hasModule" | "can">) => WIDGETS.filter((w) => (!w.module || ctx.hasModule(w.module)) && (!w.permission || ctx.can(w.permission)));
