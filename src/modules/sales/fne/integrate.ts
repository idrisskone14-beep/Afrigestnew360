import "server-only";
import { randomUUID } from "node:crypto";
import { audit } from "@/core/audit";
import { assertWithinLimit, getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { d } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/ctx-factory";

/**
 * Intégration du registre FNE aux ventes : crée dans Global Gest les clients, les factures et les avoirs de l'export de la DGI.
 *
 * Principes (à ne pas casser) :
 *  - L'export ne contient QUE les totaux, pas les articles : chaque facture reçoit une seule ligne « Facture FNE n° … ».
 *  - Le numéro de la facture est son numéro FNE : on ne consomme jamais la numérotation de l'entreprise.
 *  - Aucune écriture comptable, aucun mouvement de stock, aucun encaissement : l'historique est supposé déjà tenu ailleurs.
 *    Les documents sont marqués `importSource` : le rattrapage comptable les ignore.
 *  - Statut « émise », à encaisser, SANS date d'échéance : pas de rafale d'alertes « facture échue ». L'utilisateur gère lui-même
 *    le payé / impayé avec les paiements habituels.
 *  - Marqués « certifiés FNE » et « envoyés » (ils sont déjà chez la DGI) : jamais renvoyés, jamais comptés « non envoyés ».
 *  - Une facture déjà présente (certifiée depuis Global Gest) est RATTACHÉE, jamais doublée. Ré-exécutable sans risque.
 *  - Les proformas ne sont pas intégrées (ce ne sont pas des ventes).
 */

export const FNE_IMPORT_SOURCE = "fne_export";
const CHUNK = 100;

type Ctx = Pick<TenantContext, "db" | "tx" | "company" | "user">;

export interface FneIntegrationResult {
  customersCreated: number;
  customersMatched: number;
  invoicesCreated: number;
  /** déjà présentes dans les ventes (même numéro FNE) : rattachées, pas recréées */
  invoicesLinked: number;
  creditNotesCreated: number;
  creditNotesLinked: number;
  /** avoirs dont la facture d'origine est absente des ventes et du registre : laissés de côté */
  refundsWithoutInvoice: number;
  /** documents dont HT + TVA ne retombe pas sur le TTC (à vérifier dans l'espace FNE) */
  amountsToCheck: number;
  /** documents du registre qui restent à intégrer */
  remaining: number;
}

export interface FneIntegrationPending { invoices: number; refunds: number; proformas: number }

export async function countPendingIntegration(ctx: Pick<TenantContext, "db">): Promise<FneIntegrationPending> {
  const [invoices, refunds, proformas] = await Promise.all([
    ctx.db.fneRegistryEntry.count({ where: { kind: "INVOICE", integratedAt: null } }),
    ctx.db.fneRegistryEntry.count({ where: { kind: "REFUND", integratedAt: null } }),
    ctx.db.fneRegistryEntry.count({ where: { kind: "PROFORMA" } }),
  ]);
  return { invoices, refunds, proformas };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const customerKey = (e: { customerNcc: string | null; customerName: string }) => (e.customerNcc ? `ncc:${norm(e.customerNcc)}` : `name:${norm(e.customerName)}`);

/** Taux de TVA en pourcentage, ramené à 18 / 9 / 0 quand l'écart n'est qu'un arrondi. */
function rateOf(ht: ReturnType<typeof d>, vat: ReturnType<typeof d>): string {
  if (ht.isZero()) return "0";
  const pct = vat.div(ht).mul(100);
  for (const known of [18, 9, 0]) if (pct.minus(known).abs().lt(0.1)) return String(known);
  return pct.toDecimalPlaces(2).toString();
}

const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export async function integrateFneRegistry(ctx: Ctx): Promise<FneIntegrationResult> {
  const companyId = ctx.company.id;
  const result: FneIntegrationResult = {
    customersCreated: 0, customersMatched: 0, invoicesCreated: 0, invoicesLinked: 0, creditNotesCreated: 0, creditNotesLinked: 0,
    refundsWithoutInvoice: 0, amountsToCheck: 0, remaining: 0,
  };

  const pending = await ctx.db.fneRegistryEntry.findMany({ where: { integratedAt: null, kind: { in: ["INVOICE", "REFUND"] } }, orderBy: [{ issuedAt: "asc" }, { reference: "asc" }] });
  if (pending.length === 0) return result;
  const invoices = pending.filter((e) => e.kind === "INVOICE");
  const refunds = pending.filter((e) => e.kind === "REFUND");

  // ── 1. Clients : rapprochés par NCC puis par nom ; seuls les manquants sont créés ──────────────────────────────────────
  const existing = await ctx.db.customer.findMany({ where: { deletedAt: null }, select: { id: true, name: true, taxId: true } });
  const byTax = new Map(existing.filter((c) => c.taxId).map((c) => [norm(c.taxId!), c.id]));
  const byName = new Map(existing.map((c) => [norm(c.name), c.id]));
  const customerIds = new Map<string, string>();
  const toCreate = new Map<string, { name: string; ncc: string | null; phone: string | null; email: string | null }>();
  for (const e of pending) {
    const key = customerKey(e);
    if (customerIds.has(key)) continue;
    const found = (e.customerNcc && byTax.get(norm(e.customerNcc))) || byName.get(norm(e.customerName));
    if (found) { customerIds.set(key, found); continue; }
    // les entrées sont triées par date : la dernière occurrence donne les coordonnées les plus récentes
    toCreate.set(key, { name: e.customerName, ncc: e.customerNcc, phone: e.customerPhone, email: e.customerEmail });
  }
  for (const e of pending) { const t = toCreate.get(customerKey(e)); if (t) { t.phone = e.customerPhone ?? t.phone; t.email = e.customerEmail ?? t.email; } }
  result.customersMatched = new Set(pending.map(customerKey)).size - toCreate.size;
  if (toCreate.size > 0) {
    const [limits, usage] = await Promise.all([getEffectiveLimits(companyId), getUsage(companyId)]);
    assertWithinLimit(limits, "customers", usage.customers, toCreate.size);
    for (const part of chunks([...toCreate.entries()], CHUNK)) {
      await ctx.tx(async (tx) => {
        for (const [key, c] of part) {
          const code = await nextNumber(tx, companyId, "customer");
          const created = await tx.customer.create({
            data: { companyId, code, type: "COMPANY", name: c.name, taxId: c.ncc, phone: c.phone, email: c.email, country: ctx.company.country, notes: "Créé à l'intégration du registre FNE.", ownerId: ctx.user.id, createdById: ctx.user.id },
            select: { id: true },
          });
          customerIds.set(key, created.id);
          result.customersCreated++;
        }
      });
    }
  }

  // ── 2. Factures ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const allRefs = [...new Set([...invoices.map((e) => e.reference), ...refunds.map((e) => e.initialReference).filter((r): r is string => Boolean(r))])];
  const known = new Map<string, { id: string; customerId: string }>(); // numéro FNE → facture des ventes
  for (const part of chunks(allRefs, 500)) {
    const found = await ctx.db.invoice.findMany({ where: { OR: [{ fneReference: { in: part } }, { number: { in: part } }] }, select: { id: true, number: true, fneReference: true, customerId: true } });
    for (const f of found) { if (f.fneReference) known.set(f.fneReference, f); if (f.number) known.set(f.number, f); }
  }

  const fresh = invoices.filter((e) => !known.has(e.reference));
  const freshIds = new Set(fresh.map((e) => e.id));
  result.invoicesLinked = invoices.length - fresh.length;
  for (const part of chunks(fresh, CHUNK)) {
    await ctx.tx(async (tx) => {
      const rows = part.map((e) => {
        const ht = d(e.totalHt), vat = d(e.totalVat), ttc = d(e.totalTtc);
        if (ht.plus(vat).minus(ttc).abs().gt(1)) result.amountsToCheck++;
        return { e, id: randomUUID(), ht, vat, ttc, rate: rateOf(ht, vat), customerId: customerIds.get(customerKey(e))! };
      });
      await tx.invoice.createMany({
        data: rows.map(({ e, id, ht, vat, ttc, customerId }) => ({
          id, companyId, number: e.reference, kind: "STANDARD" as const, customerId, status: "ISSUED" as const, issueDate: e.issuedAt, dueDate: null,
          currency: e.currency, subtotal: ht.toString(), discountTotal: "0", taxTotal: vat.toString(), total: ttc.toString(), amountPaid: "0", creditedAmount: "0",
          notes: "Reprise de l'export FNE : facture certifiée par la DGI.", issuedAt: e.issuedAt, sentAt: e.issuedAt, createdById: ctx.user.id,
          fneStatus: "CERTIFIED" as const, fneReference: e.reference, fneTemplate: e.template, fnePaymentMethod: e.paymentMethod, fneCertifiedAt: e.issuedAt, importSource: FNE_IMPORT_SOURCE,
        })),
      });
      await tx.invoiceLine.createMany({
        data: rows.map(({ e, id, ht, vat, ttc, rate }) => ({
          companyId, invoiceId: id, position: 0, description: `Facture FNE n° ${e.reference}`, unit: "forfait", quantity: "1", unitPrice: ht.toString(), discountPct: "0",
          taxRate: rate, netAmount: ht.toString(), taxAmount: vat.toString(), total: ttc.toString(),
        })),
      });
      for (const r of rows) {
        await tx.fneRegistryEntry.update({ where: { id: r.e.id }, data: { invoiceId: r.id, integratedAt: new Date() } });
        known.set(r.e.reference, { id: r.id, customerId: r.customerId });
        result.invoicesCreated++;
      }
    });
  }
  // factures déjà présentes dans les ventes : on relie simplement l'entrée du registre
  for (const part of chunks(invoices.filter((e) => !freshIds.has(e.id)), CHUNK)) {
    await ctx.tx(async (tx) => { for (const e of part) await tx.fneRegistryEntry.update({ where: { id: e.id }, data: { invoiceId: known.get(e.reference)!.id, integratedAt: new Date() } }); });
  }

  // ── 3. Avoirs : rattachés à la facture d'origine ──────────────────────────────────────────────────────────────────────
  const knownCn = new Map<string, string>();
  const refundRefs = refunds.map((e) => e.reference);
  for (const part of chunks(refundRefs, 500)) {
    const found = await ctx.db.creditNote.findMany({ where: { OR: [{ fneReference: { in: part } }, { number: { in: part } }] }, select: { id: true, number: true, fneReference: true } });
    for (const f of found) { if (f.fneReference) knownCn.set(f.fneReference, f.id); if (f.number) knownCn.set(f.number, f.id); }
  }
  for (const part of chunks(refunds, CHUNK)) {
    await ctx.tx(async (tx) => {
      for (const e of part) {
        const already = knownCn.get(e.reference);
        if (already) { await tx.fneRegistryEntry.update({ where: { id: e.id }, data: { creditNoteId: already, integratedAt: new Date() } }); result.creditNotesLinked++; continue; }
        const origin = e.initialReference ? known.get(e.initialReference) : undefined;
        if (!origin) { result.refundsWithoutInvoice++; continue; }
        const ht = d(e.totalHt).abs(), vat = d(e.totalVat).abs(), ttc = d(e.totalTtc).abs();
        if (ht.plus(vat).minus(ttc).abs().gt(1)) result.amountsToCheck++;
        const cn = await tx.creditNote.create({
          data: {
            companyId, number: e.reference, invoiceId: origin.id, customerId: origin.customerId, status: "ISSUED", issueDate: e.issuedAt,
            reason: "Reprise de l'export FNE : avoir certifié par la DGI.", restock: false, currency: e.currency,
            subtotal: ht.toString(), taxTotal: vat.toString(), total: ttc.toString(), createdById: ctx.user.id,
            fneStatus: "CERTIFIED", fneReference: e.reference.startsWith("SANS-NUMERO-") ? null : e.reference, fneCertifiedAt: e.issuedAt, importSource: FNE_IMPORT_SOURCE,
            lines: { create: [{ companyId, position: 0, description: `Avoir FNE sur la facture n° ${e.initialReference}`, unit: "forfait", quantity: "1", unitPrice: ht.toString(), discountPct: "0", taxRate: rateOf(ht, vat), netAmount: ht.toString(), taxAmount: vat.toString(), total: ttc.toString() }] },
          },
          select: { id: true },
        });
        await tx.invoice.update({ where: { id: origin.id }, data: { creditedAmount: { increment: ttc.toString() } } });
        await tx.fneRegistryEntry.update({ where: { id: e.id }, data: { creditNoteId: cn.id, integratedAt: new Date() } });
        result.creditNotesCreated++;
      }
    });
  }

  result.remaining = await ctx.db.fneRegistryEntry.count({ where: { integratedAt: null, kind: { in: ["INVOICE", "REFUND"] } } });
  await audit(ctx as TenantContext, {
    action: "fne.registry.integrate", resource: "FneRegistryEntry", resourceId: companyId,
    summary: `${ctx.user.name} a intégré le registre FNE aux ventes : ${result.invoicesCreated} facture${result.invoicesCreated > 1 ? "s" : ""}, ${result.creditNotesCreated} avoir${result.creditNotesCreated > 1 ? "s" : ""}, ${result.customersCreated} client${result.customersCreated > 1 ? "s" : ""} créé${result.customersCreated > 1 ? "s" : ""}.`,
    after: result,
  });
  return result;
}
