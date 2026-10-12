import "server-only";
import { audit } from "@/core/audit";
import { businessRule, conflict, notFound } from "@/core/errors";
import { computeLine, d, roundMoney, type Decimal } from "@/core/money";
import type { Db } from "@/core/db/client";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import { z } from "zod";
import { getOrder } from "./orders";
import { getQuote } from "./quotes";

/**
 * Factures d'acompte. Un acompte est une VRAIE facture (numérotée, comptabilisée, encaissable) émise avant la livraison, à partir
 * d'un devis ou d'une commande. La facture finale reprend tout le détail et DÉDUIT les acomptes déjà facturés par des lignes
 * négatives (même taux de TVA) : le chiffre d'affaires et la TVA ne sont donc comptés qu'une fois, et le client ne paie que le solde.
 */
type Ctx = TenantContext;
const LIVE = ["ISSUED", "PARTIALLY_PAID", "PAID"] as const;

export const depositSchema = z.object({
  source: z.enum(["quote", "order"]),
  id: z.string().uuid(),
  mode: z.enum(["percent", "amount"]),
  value: z.coerce.number().positive("Valeur > 0").max(1e13),
});

interface SourceDoc {
  label: string; number: string; total: Decimal; currency: string; customerId: string; orderId: string | null; quoteId: string | null;
  lines: { netAmount: unknown; taxId: string | null; taxRate: unknown }[];
}

async function loadSource(ctx: Ctx, source: "quote" | "order", id: string): Promise<SourceDoc> {
  if (source === "quote") {
    const q = await getQuote(ctx, id);
    if (q.kind !== "QUOTE") throw businessRule("Un acompte se demande sur un devis, pas sur une facture proforma.");
    if (q.status === "REJECTED") throw businessRule("Ce devis a été refusé.");
    if (q.status === "CONVERTED") throw businessRule("Ce devis a été converti : créez l'acompte depuis la commande ou facturez directement.");
    return { label: "devis", number: q.number, total: d(q.total), currency: q.currency, customerId: q.customerId, orderId: null, quoteId: q.id, lines: q.lines };
  }
  const o = await getOrder(ctx, id);
  if (o.status === "DRAFT" || o.status === "CANCELLED") throw businessRule("Confirmez la commande avant de demander un acompte.");
  return { label: "commande", number: o.number, total: d(o.total), currency: o.currency, customerId: o.customerId, orderId: o.id, quoteId: o.quoteId, lines: o.lines };
}

const linkedTo = (s: { orderId: string | null; quoteId: string | null }) => ({ OR: [...(s.orderId ? [{ orderId: s.orderId }] : []), ...(s.quoteId ? [{ quoteId: s.quoteId }] : [])] });

/** Acomptes déjà facturés (non annulés) pour ce devis / cette commande. */
export async function depositsOf(ctx: Pick<Ctx, "db">, s: { orderId: string | null; quoteId: string | null }) {
  if (!s.orderId && !s.quoteId) return [];
  return ctx.db.invoice.findMany({ where: { kind: "DEPOSIT", status: { not: "CANCELLED" }, ...linkedTo(s) }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, status: true, total: true, deductedInId: true } });
}

/** Facture d'acompte (brouillon) : un pourcentage du TTC, ou un montant TTC, réparti au prorata de chaque taux de TVA du document. */
export async function createDepositInvoice(ctx: Ctx, input: z.output<typeof depositSchema>) {
  const src = await loadSource(ctx, input.source, input.id);
  const customer = await ctx.db.customer.findFirst({ where: { id: src.customerId, deletedAt: null } });
  if (!customer) throw notFound("Client");
  if (!customer.isActive) throw businessRule("Ce client est inactif.");
  if (src.total.lte(0)) throw businessRule("Ce document n'a aucun montant.");

  const requested = input.mode === "percent" ? roundMoney(src.total.mul(input.value).div(100), src.currency) : roundMoney(input.value, src.currency);
  if (input.mode === "percent" && input.value >= 100) throw businessRule("Un acompte doit être inférieur à 100 % : pour tout facturer, créez une facture.");
  const already = (await depositsOf(ctx, src)).reduce((a, x) => a.plus(d(x.total)), d(0));
  if (requested.lte(0)) throw businessRule("Le montant de l'acompte est trop faible.");
  if (already.plus(requested).gte(src.total)) {
    throw businessRule(`Avec cet acompte, les acomptes (${formatMoney(already.plus(requested).toNumber(), src.currency)}) atteindraient le total du ${src.label} (${formatMoney(src.total.toNumber(), src.currency)}). Facturez plutôt le solde.`);
  }

  // base HT par taux de TVA, puis prorata
  const groups = new Map<string, { taxId: string | null; rate: Decimal; net: Decimal }>();
  for (const l of src.lines) {
    const key = `${l.taxId ?? ""}|${d(l.taxRate as number).toString()}`;
    const g = groups.get(key) ?? { taxId: l.taxId, rate: d(l.taxRate as number), net: d(0) };
    g.net = g.net.plus(d(l.netAmount as number));
    groups.set(key, g);
  }
  const ratio = requested.div(src.total);
  const pct = ratio.mul(100).toDecimalPlaces(2).toString().replace(".", ",");
  const multi = groups.size > 1;
  const issue = new Date();
  const rows = [...groups.values()].filter((g) => g.net.gt(0)).map((g, i) => {
    const ht = roundMoney(g.net.mul(ratio), src.currency);
    const a = computeLine({ quantity: 1, unitPrice: ht, discountPct: 0, taxRate: g.rate }, src.currency);
    return { companyId: ctx.company.id, position: i, productId: null, description: `Acompte de ${pct} % sur ${src.label} ${src.number}${multi ? ` (TVA ${g.rate.toString()} %)` : ""}`, unit: "forfait", quantity: "1", unitPrice: ht.toString(), discountPct: "0", taxId: g.taxId, taxRate: g.rate.toString(), netAmount: a.net.toString(), taxAmount: a.tax.toString(), total: a.total.toString(), gross: a.gross };
  });
  const sum = (f: (r: (typeof rows)[number]) => string) => rows.reduce((a, r) => a.plus(d(f(r))), d(0)).toString();

  const inv = await ctx.db.invoice.create({
    data: {
      companyId: ctx.company.id, kind: "DEPOSIT", customerId: customer.id, orderId: src.orderId, quoteId: src.quoteId, status: "DRAFT", issueDate: issue, dueDate: issue, currency: src.currency,
      subtotal: sum((r) => r.gross.toString()), discountTotal: "0", taxTotal: sum((r) => r.taxAmount), total: sum((r) => r.total), notes: `Acompte sur ${src.label} ${src.number}.`, createdById: ctx.user.id,
      lines: { create: rows.map(({ gross: _g, ...r }) => r) },
    },
  });
  await audit(ctx, { action: "invoice.create_deposit", resource: "Invoice", resourceId: inv.id, summary: `${ctx.user.name} a créé une facture d'acompte de ${formatMoney(d(inv.total).toNumber(), src.currency)} (${pct} %) sur le ${src.label} ${src.number}.`, after: { source: input.source, sourceId: input.id, total: inv.total } });
  return inv;
}

export interface DeductionLine {
  companyId: string; position: number; productId: null; description: string; unit: string; quantity: string; unitPrice: string; discountPct: string; taxId: string | null; taxRate: string;
  netAmount: string; taxAmount: string; total: string;
}

/**
 * Lignes négatives qui déduisent, sur la facture finale, les acomptes émis et pas encore déduits. Renvoie null s'il n'y en a pas, ou si
 * la facture finale ne couvre pas les acomptes (ils restent à déduire d'une facture suivante). Les acomptes sont verrouillés par
 * `markDepositsDeducted` dans la même transaction que la création de la facture.
 */
export async function deductionFor(db: Pick<Db, "invoice">, companyId: string, link: { orderId: string | null; quoteId: string | null }, currency: string, invoiceTotal: Decimal, firstPosition: number) {
  if (!link.orderId && !link.quoteId) return null;
  const deposits = await db.invoice.findMany({
    where: { kind: "DEPOSIT", status: { in: [...LIVE] }, deductedInId: null, ...linkedTo(link) },
    include: { lines: { orderBy: { position: "asc" } } }, orderBy: { createdAt: "asc" },
  });
  if (deposits.length === 0) return null;
  let gross = d(0), tax = d(0), total = d(0);
  const lines: DeductionLine[] = [];
  for (const dep of deposits) {
    for (const l of dep.lines) {
      const a = computeLine({ quantity: -1, unitPrice: d(l.netAmount), discountPct: 0, taxRate: d(l.taxRate) }, currency);
      gross = gross.plus(a.gross); tax = tax.plus(a.tax); total = total.plus(a.total);
      lines.push({ companyId, position: firstPosition + lines.length, productId: null, description: `À déduire : acompte ${dep.number}${dep.lines.length > 1 ? ` — ${l.description}` : ""}`, unit: "forfait", quantity: "-1", unitPrice: d(l.netAmount).toString(), discountPct: "0", taxId: l.taxId, taxRate: d(l.taxRate).toString(), netAmount: a.net.toString(), taxAmount: a.tax.toString(), total: a.total.toString() });
    }
  }
  if (invoiceTotal.plus(total).lte(0)) return null; // la facture ne couvre pas les acomptes
  return { lines, gross, tax, total, depositIds: deposits.map((x) => x.id) };
}

export async function markDepositsDeducted(tx: Pick<Db, "invoice">, depositIds: string[], invoiceId: string) {
  if (depositIds.length === 0) return;
  const res = await tx.invoice.updateMany({ where: { id: { in: depositIds }, deductedInId: null }, data: { deductedInId: invoiceId } });
  if (res.count !== depositIds.length) throw conflict("Un acompte vient d'être déduit d'une autre facture : relancez la création.");
}

/** Libère les acomptes déduits par une facture supprimée ou annulée (ils redeviennent déductibles). */
export async function releaseDeposits(tx: Pick<Db, "invoice">, invoiceId: string) {
  await tx.invoice.updateMany({ where: { deductedInId: invoiceId }, data: { deductedInId: null } });
}
