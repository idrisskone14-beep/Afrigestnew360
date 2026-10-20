import "server-only";
import { audit } from "@/core/audit";
import { roundMoney } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { parseDate } from "@/core/documents/lines";

/**
 * Reprise des soldes d'ouverture : factures encore ouvertes dans l'application d'origine.
 *
 * Elles sont créées directement à l'état « émise » (numéro et dates d'origine conservés), SANS passer par l'émission :
 * ni nouveau numéro légal, ni mouvement de stock, ni écriture comptable automatique (la comptabilité reprend ses soldes
 * par la balance d'ouverture), ni notification. Elles alimentent en revanche le suivi des créances/dettes, l'échéancier
 * et la trésorerie prévisionnelle, et reçoivent les paiements ultérieurs comme n'importe quelle facture.
 */
export interface OpeningDocument {
  /** N° de la facture dans l'application d'origine. */
  number: string;
  /** Client ou fournisseur. */
  partyId: string;
  partyName: string;
  date: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  notes: string;
}

type Ctx = TenantContext;

const taxRateOf = (subtotal: number, tax: number) => (subtotal > 0 ? Math.round((tax / subtotal) * 10_000) / 100 : 0);

export async function createOpeningInvoice(ctx: Ctx, p: OpeningDocument) {
  const cur = ctx.company.currency;
  const total = roundMoney(p.total, cur), paid = roundMoney(p.amountPaid, cur), sub = roundMoney(p.subtotal, cur), tax = roundMoney(p.taxTotal, cur);
  const issue = parseDate(p.date)!, due = parseDate(p.dueDate)!;
  const inv = await ctx.tx(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        companyId: ctx.company.id, number: p.number, customerId: p.partyId, status: paid.gt(0) ? "PARTIALLY_PAID" : "ISSUED", issueDate: issue, dueDate: due, currency: cur,
        subtotal: sub.toString(), discountTotal: "0", taxTotal: tax.toString(), total: total.toString(), amountPaid: paid.toString(), notes: p.notes || null, issuedAt: issue, createdById: ctx.user.id,
        lines: { create: [{ companyId: ctx.company.id, position: 0, description: `Reprise de la facture ${p.number}`, unit: "forfait", quantity: "1", unitPrice: sub.toString(), discountPct: "0", taxId: null, taxRate: String(taxRateOf(sub.toNumber(), tax.toNumber())), netAmount: sub.toString(), taxAmount: tax.toString(), total: total.toString() }] },
      },
    });
    // une seule échéance, à la date d'échéance d'origine : le suivi des échéances et les paiements s'y imputent
    await tx.invoiceInstallment.create({ data: { companyId: ctx.company.id, invoiceId: created.id, position: 0, dueDate: due, amount: total.toString(), paidAmount: paid.toString() } });
    return created;
  });
  await audit(ctx, { action: "invoice.import", resource: "Invoice", resourceId: inv.id, summary: `${ctx.user.name} a repris la facture ${p.number} de ${p.partyName} (solde d'ouverture, ${total.toString()} ${cur}).`, after: { total: total.toString(), amountPaid: paid.toString() } });
  return inv;
}

export async function createOpeningBill(ctx: Ctx, p: OpeningDocument) {
  const cur = ctx.company.currency;
  const total = roundMoney(p.total, cur), paid = roundMoney(p.amountPaid, cur), sub = roundMoney(p.subtotal, cur), tax = roundMoney(p.taxTotal, cur);
  const date = parseDate(p.date)!, due = parseDate(p.dueDate)!;
  const bill = await ctx.tx(async (tx) => {
    // numéro interne attribué comme à la comptabilisation ; le numéro d'origine est conservé comme référence fournisseur
    const number = await nextNumber(tx, ctx.company.id, "supplier_bill", date);
    return tx.supplierBill.create({
      data: {
        companyId: ctx.company.id, number, supplierRef: p.number, supplierId: p.partyId, status: paid.gt(0) ? "PARTIALLY_PAID" : "POSTED", billDate: date, dueDate: due, currency: cur,
        subtotal: sub.toString(), discountTotal: "0", taxTotal: tax.toString(), total: total.toString(), amountPaid: paid.toString(), notes: p.notes || null, postedAt: date, createdById: ctx.user.id,
        lines: { create: [{ companyId: ctx.company.id, position: 0, description: `Reprise de la facture ${p.number}`, unit: "forfait", quantity: "1", unitPrice: sub.toString(), discountPct: "0", taxId: null, taxRate: String(taxRateOf(sub.toNumber(), tax.toNumber())), netAmount: sub.toString(), taxAmount: tax.toString(), total: total.toString() }] },
      },
    });
  });
  await audit(ctx, { action: "supplier_bill.import", resource: "SupplierBill", resourceId: bill.id, summary: `${ctx.user.name} a repris la facture fournisseur ${p.number} de ${p.partyName} (solde d'ouverture, ${total.toString()} ${cur}).`, after: { total: total.toString(), amountPaid: paid.toString() } });
  return bill;
}
