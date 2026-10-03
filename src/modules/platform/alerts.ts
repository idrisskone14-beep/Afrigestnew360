import "server-only";
import { platformDb, platformTransaction } from "@/core/db/client";
import { d } from "@/core/money";
import { flushPendingEmails, notify, type NotificationType } from "@/core/notifications";
import { fleetAttention, type AttentionKind } from "@/modules/fleet/costs";
import { formatMoney } from "@/lib/reference-data";

/**
 * Tâche d'alertes : crée des notifications pour les membres concernés (échéances, stock critique, contrats, documents, abonnement).
 * S'exécute côté plateforme mais travaille UNE entreprise à la fois, avec son identifiant explicite dans chaque requête.
 * Règles : module actif, destinataire détenant la permission de lecture correspondante (ou administrateur) — ou, pour les
 * documents, leur propriétaire —, préférences de notification respectées (`notify`), au plus une alerte du même type par
 * utilisateur et par fenêtre de 20 h (pas de harcèlement). Les e-mails en attente sont distribués en fin de tâche.
 */
const WINDOW_MS = 20 * 3_600_000;
const DAY = 86_400_000;

interface Alert { title: string; body: string; link: string }
interface AlertSpec {
  type: NotificationType;
  /** Module requis ; absent = alerte du cœur (toujours active). */
  module?: string;
  /** Audience : détenteurs de la permission (ou admins)… */
  permission?: string;
  /** …ou audience calculée utilisateur par utilisateur (ex. propriétaires de documents). */
  perUser?: (companyId: string, today: Date) => Promise<Map<string, Alert>>;
  compute?: (companyId: string, currency: string, today: Date) => Promise<Alert | null>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Alerte de flotte : regroupe les points d'attention d'une famille (entretiens, documents réglementaires, contraventions). */
const fleetSpec = (type: NotificationType, permission: string, kinds: AttentionKind[], title: (n: number) => string): AlertSpec => ({
  type, module: "fleet", permission,
  async compute(companyId, _currency, today) {
    const items = (await fleetAttention(platformDb, companyId, today)).filter((i) => kinds.includes(i.kind));
    if (items.length === 0) return null;
    const urgent = items.filter((i) => i.severity === "danger").length;
    return { title: title(items.length), body: `${urgent > 0 ? `${urgent} urgent${urgent > 1 ? "s" : ""} : ` : ""}${items.slice(0, 3).map((i) => i.label).join(" · ")}${items.length > 3 ? ` … (+${items.length - 3})` : ""}`, link: kinds.includes("fine") ? "/app/fleet/contraventions?statut=TO_PAY" : "/app/fleet" };
  },
});

const SPECS: AlertSpec[] = [
  fleetSpec("maintenance.due", "fleet.vehicle.read", ["maintenance"], (n) => `${plural(n, "entretien")} de véhicule à prévoir`),
  fleetSpec("vehicle.expiring", "fleet.vehicle.read", ["insurance", "inspection", "registration", "document", "license"], (n) => `${plural(n, "document")} de flotte à renouveler`),
  fleetSpec("fine.due", "fleet.fine.read", ["fine"], (n) => `${plural(n, "contravention")} à payer`),
  {
    type: "invoice.overdue", module: "sales", permission: "finance.invoice.read",
    async compute(companyId, currency, today) {
      const rows = await platformDb.invoice.findMany({ where: { companyId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today } }, select: { total: true, amountPaid: true, creditedAmount: true }, take: 5000 });
      const open = rows.map((r) => d(r.total).minus(r.amountPaid).minus(r.creditedAmount)).filter((b) => b.gt(0));
      if (open.length === 0) return null;
      const total = open.reduce((a, b) => a.plus(b), d(0));
      return { title: `${plural(open.length, "facture")} client en retard`, body: `${formatMoney(total.toNumber(), currency)} à relancer.`, link: "/app/sales/relances" };
    },
  },
  {
    type: "bill.overdue", module: "purchases", permission: "purchases.bill.read",
    async compute(companyId, currency, today) {
      const rows = await platformDb.supplierBill.findMany({ where: { companyId, status: { in: ["POSTED", "PARTIALLY_PAID"] }, dueDate: { lt: today } }, select: { total: true, amountPaid: true }, take: 5000 });
      const open = rows.map((r) => d(r.total).minus(r.amountPaid)).filter((b) => b.gt(0));
      if (open.length === 0) return null;
      const total = open.reduce((a, b) => a.plus(b), d(0));
      return { title: `${plural(open.length, "facture")} fournisseur échue${open.length > 1 ? "s" : ""}`, body: `${formatMoney(total.toNumber(), currency)} à régler.`, link: "/app/purchases/factures?statut=OVERDUE" };
    },
  },
  {
    // Échéances des 3 prochains jours (clients à relancer par avance, fournisseurs à préparer)
    type: "due_date", module: "finance", permission: "finance.account.read",
    async compute(companyId, currency, today) {
      const limit = new Date(today.getTime() + 3 * DAY);
      const [inv, bills] = await Promise.all([
        platformDb.invoice.findMany({ where: { companyId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { gte: today, lte: limit } }, select: { total: true, amountPaid: true, creditedAmount: true }, take: 5000 }),
        platformDb.supplierBill.findMany({ where: { companyId, status: { in: ["POSTED", "PARTIALLY_PAID"] }, dueDate: { gte: today, lte: limit } }, select: { total: true, amountPaid: true }, take: 5000 }),
      ]);
      const toCollect = inv.map((r) => d(r.total).minus(r.amountPaid).minus(r.creditedAmount)).filter((b) => b.gt(0));
      const toPay = bills.map((r) => d(r.total).minus(r.amountPaid)).filter((b) => b.gt(0));
      if (toCollect.length + toPay.length === 0) return null;
      const sum = (a: ReturnType<typeof d>[]) => a.reduce((x, y) => x.plus(y), d(0)).toNumber();
      const parts = [toCollect.length ? `${plural(toCollect.length, "encaissement")} (${formatMoney(sum(toCollect), currency)})` : "", toPay.length ? `${plural(toPay.length, "règlement")} (${formatMoney(sum(toPay), currency)})` : ""].filter(Boolean);
      return { title: "Échéances dans les 3 jours", body: parts.join(" · "), link: "/app/finance/echeancier" };
    },
  },
  {
    type: "stock.low", module: "inventory", permission: "inventory.stock.read",
    async compute(companyId) {
      // requête brute : doit s'exécuter dans une transaction plateforme (contexte RLS posé) ; l'entreprise est explicite
      const rows = await platformTransaction((tx) => tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM (
          SELECT p."id" FROM "Product" p LEFT JOIN "StockLevel" l ON l."productId" = p."id"
          WHERE p."companyId" = ${companyId}::uuid AND p."trackStock" AND p."isActive" AND p."deletedAt" IS NULL AND p."minStock" > 0
          GROUP BY p."id", p."minStock"
          HAVING COALESCE(SUM(l."quantity"), 0) - COALESCE(SUM(l."reserved"), 0) <= p."minStock"
        ) t`);
      const n = Number(rows[0]?.n ?? 0);
      return n === 0 ? null : { title: `${plural(n, "produit")} sous le seuil de stock`, body: "Pensez à réapprovisionner.", link: "/app/inventory" };
    },
  },
  {
    type: "contract.ending", module: "hr", permission: "hr.contract.manage",
    async compute(companyId, _currency, today) {
      const limit = new Date(today.getTime() + 30 * DAY);
      const n = await platformDb.employmentContract.count({ where: { companyId, endDate: { gte: today, lte: limit }, employee: { status: "ACTIVE", deletedAt: null } } });
      return n === 0 ? null : { title: `${plural(n, "contrat")} arrivant à échéance`, body: "Échéance dans les 30 prochains jours : renouvelez ou clôturez.", link: "/app/hr/salaries" };
    },
  },
  {
    type: "leave.request", module: "hr", permission: "hr.leave.approve",
    async compute(companyId) {
      const n = await platformDb.leaveRequest.count({ where: { companyId, status: "PENDING" } });
      return n === 0 ? null : { title: `${plural(n, "demande")} de congé en attente`, body: "À traiter dans les validations.", link: "/app/hr/conges?statut=PENDING" };
    },
  },
  {
    // Chaque propriétaire est alerté de SES documents qui expirent sous 30 jours (ou ont expiré)
    type: "document.expiring", module: "documents",
    async perUser(companyId, today) {
      const limit = new Date(today.getTime() + 30 * DAY);
      const docs = await platformDb.document.findMany({ where: { companyId, deletedAt: null, status: "ACTIVE", expiresAt: { not: null, lte: limit } }, select: { ownerId: true, expiresAt: true }, take: 5000 });
      const by = new Map<string, { expired: number; soon: number }>();
      for (const x of docs) {
        const e = by.get(x.ownerId) ?? { expired: 0, soon: 0 };
        if (x.expiresAt! < today) e.expired++; else e.soon++;
        by.set(x.ownerId, e);
      }
      return new Map([...by].map(([owner, e]) => [owner, {
        title: `${plural(e.expired + e.soon, "document")} à renouveler`,
        body: [e.expired ? `${plural(e.expired, "expiré")}` : "", e.soon ? `${plural(e.soon, "expire", "expirent")} sous 30 jours` : ""].filter(Boolean).join(" · "),
        link: "/app/documents?statut=expire",
      }]));
    },
  },
  {
    type: "subscription", permission: "settings.billing.read",
    async compute(companyId, _currency, today) {
      const sub = await platformDb.subscription.findUnique({ where: { companyId }, select: { status: true, trialEndsAt: true, currentPeriodEnd: true } });
      if (!sub) return null;
      const link = "/app/parametres/abonnement";
      if (sub.status === "PAST_DUE") return { title: "Abonnement en retard de paiement", body: "Régularisez pour éviter la suspension de votre accès.", link };
      if (sub.status === "TRIALING" && sub.trialEndsAt) {
        const left = Math.ceil((sub.trialEndsAt.getTime() - today.getTime()) / DAY);
        if (left <= 7) return { title: left < 0 ? "Votre période d'essai est terminée" : `Votre essai se termine dans ${plural(Math.max(left, 0), "jour")}`, body: "Choisissez une offre pour conserver vos modules.", link };
      }
      return null;
    },
  },
];

export async function generateAlerts(companyId: string, now = new Date()) {
  const company = await platformDb.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true, currency: true } });
  if (!company) return { created: 0 };
  const modules = new Set((await platformDb.companyModule.findMany({ where: { companyId, enabled: true, module: { isActive: true } }, select: { module: { select: { key: true } } } })).map((m) => m.module.key));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let created = 0;

  for (const spec of SPECS) {
    if (spec.module && !modules.has(spec.module)) continue;

    // audience → message par utilisateur
    const messages = new Map<string, Alert>();
    if (spec.perUser) {
      for (const [userId, alert] of await spec.perUser(companyId, today)) messages.set(userId, alert);
    } else {
      const alert = await spec.compute!(companyId, company.currency, today);
      if (!alert) continue;
      const members = await platformDb.companyMembership.findMany({
        where: { companyId, status: "ACTIVE", OR: [{ role: { isAdmin: true } }, { role: { permissions: { some: { permission: { key: spec.permission! } } } } }] },
        select: { userId: true },
      });
      for (const m of members) messages.set(m.userId, alert);
    }
    // un propriétaire de document qui a quitté l'entreprise n'est plus destinataire
    const active = new Set((await platformDb.companyMembership.findMany({ where: { companyId, status: "ACTIVE", userId: { in: [...messages.keys()] } }, select: { userId: true } })).map((m) => m.userId));
    const recent = new Set((await platformDb.notification.findMany({ where: { companyId, type: spec.type, userId: { in: [...messages.keys()] }, createdAt: { gte: new Date(now.getTime() - WINDOW_MS) } }, select: { userId: true } })).map((n) => n.userId));

    // regroupement par message identique pour limiter les écritures
    const byMessage = new Map<string, { alert: Alert; users: string[] }>();
    for (const [userId, alert] of messages) {
      if (!active.has(userId) || recent.has(userId)) continue;
      const key = `${alert.title}|${alert.body}|${alert.link}`;
      const g = byMessage.get(key) ?? { alert, users: [] };
      g.users.push(userId);
      byMessage.set(key, g);
    }
    for (const { alert, users } of byMessage.values()) created += await notify(platformDb, { companyId, userIds: users, type: spec.type, ...alert });
  }
  return { created };
}

/** Toutes les entreprises actives (appelée par la route planifiée), puis distribution des e-mails en attente. */
export async function generateAllAlerts(now = new Date()) {
  const companies = await platformDb.company.findMany({ where: { deletedAt: null }, select: { id: true } });
  let created = 0;
  for (const c of companies) created += (await generateAlerts(c.id, now)).created;
  const mail = await flushPendingEmails();
  return { companies: companies.length, created, emails: mail };
}
