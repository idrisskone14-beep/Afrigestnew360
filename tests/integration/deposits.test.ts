import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as crm from "@/modules/crm/service";
import { customerSchema } from "@/modules/crm/schemas";
import { d } from "@/core/money";
import { createDepositInvoice, deductionFor, depositSchema, depositsOf } from "@/modules/sales/deposits";
import * as invoices from "@/modules/sales/invoices";
import * as orders from "@/modules/sales/orders";
import * as quotes from "@/modules/sales/quotes";
import { issueInvoiceSchema, orderSchema, quoteSchema, type LineInput } from "@/modules/sales/schemas";
import { ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("ACOMPTE");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Client Acompte", email: "a@acompte.ci", paymentTermsDays: 30 }));
  const line = (over: Partial<LineInput> = {}): LineInput => ({ productId: "", description: "Prestation", unit: "forfait", quantity: 2, unitPrice: 50000, discountPct: 0, taxId: tax.id, ...over });
  const quote = (lines: LineInput[] = [line()]) => quotes.createQuote(ctx, quoteSchema.parse({ kind: "QUOTE", customerId: customer.id, issueDate: today(), validUntil: "", notes: "", terms: "", lines }));
  const order = async (lines: LineInput[] = [line()]) => {
    const o = await orders.createOrder(ctx, orderSchema.parse({ customerId: customer.id, orderDate: today(), lines }));
    await orders.confirmOrder(ctx, o.id);
    return o;
  };
  const issue = (id: string) => invoices.issueInvoice(ctx, issueInvoiceSchema.parse({ id }));
  const deposit = (source: "quote" | "order", id: string, mode: "percent" | "amount", value: number) => createDepositInvoice(ctx, depositSchema.parse({ source, id, mode, value }));
  return { ...co, ctx, tax, customer, line, quote, order, issue, deposit };
}

// 2 × 50 000 HT, TVA 18 % → 100 000 HT, 18 000 TVA, 118 000 TTC
describe("factures d'acompte", () => {
  it("crée un acompte en pourcentage du TTC, réparti par taux de TVA, relié au devis", async () => {
    const s = await setup();
    const q = await s.quote();
    const dep = await s.deposit("quote", q.id, "percent", 30);
    const full = await invoices.getInvoice(s.ctx, dep.id);
    expect(full.kind).toBe("DEPOSIT");
    expect(full.status).toBe("DRAFT");
    expect(full.quoteId).toBe(q.id);
    expect(full.lines).toHaveLength(1);
    expect(Number(full.subtotal)).toBe(30000);
    expect(Number(full.taxTotal)).toBe(5400);
    expect(Number(full.total)).toBe(35400);
    expect(full.lines[0]!.description).toContain("30 %");
    expect(full.lines[0]!.description).toContain(q.number);
  });

  it("accepte un montant TTC fixe et répartit sur plusieurs taux de TVA", async () => {
    const s = await setup();
    const q = await s.quote([s.line(), s.line({ taxId: "", unitPrice: 10000, quantity: 1, description: "Sans taxe" })]);
    // total = 118 000 + 10 000 = 128 000 ; acompte de 64 000 = 50 %
    const dep = await invoices.getInvoice(s.ctx, (await s.deposit("quote", q.id, "amount", 64000)).id);
    expect(dep.lines).toHaveLength(2);
    expect(Number(dep.total)).toBe(64000);
    expect(Number(dep.taxTotal)).toBe(9000);
  });

  it("la facture finale (depuis le devis) déduit les acomptes émis et le client ne paie que le solde", async () => {
    const s = await setup();
    const q = await s.quote();
    const dep = await s.deposit("quote", q.id, "percent", 30);
    // tant que l'acompte n'est pas émis, il n'est pas déduit
    const early = await quotes.convertQuoteToInvoice(s.ctx, (await s.quote()).id);
    expect(Number(early.total)).toBe(118000);

    await s.issue(dep.id);
    const final = await quotes.convertQuoteToInvoice(s.ctx, q.id);
    const f = await invoices.getInvoice(s.ctx, final.id);
    expect(f.lines).toHaveLength(2);
    const ded = f.lines[1]!;
    expect(Number(ded.quantity)).toBe(-1);
    expect(Number(ded.netAmount)).toBe(-30000);
    expect(Number(ded.taxAmount)).toBe(-5400);
    expect(Number(f.subtotal)).toBe(70000);
    expect(Number(f.taxTotal)).toBe(12600);
    expect(Number(f.total)).toBe(82600);
    expect(ded.description).toContain(`acompte ${(await invoices.getInvoice(s.ctx, dep.id)).number}`);
    expect((await invoices.getInvoice(s.ctx, dep.id)).deductedInId).toBe(final.id);
    // le revenu total reste celui du devis : acompte + solde HT = 100 000
    const issued = await s.issue(final.id);
    expect(issued.status).toBe("ISSUED");
  });

  it("depuis une commande : déduction dans la facture finale, et libération si le brouillon est supprimé ou la facture annulée", async () => {
    const s = await setup();
    const o = await s.order();
    const dep = await s.deposit("order", o.id, "percent", 20);
    await s.issue(dep.id);
    const final = await invoices.createInvoiceFromOrder(s.ctx, o.id);
    expect(Number((await invoices.getInvoice(s.ctx, final.id)).total)).toBe(94400); // 118 000 − 23 600
    expect((await depositsOf(s.ctx, { orderId: o.id, quoteId: null }))[0]!.deductedInId).toBe(final.id);

    await invoices.deleteInvoice(s.ctx, final.id);
    expect((await depositsOf(s.ctx, { orderId: o.id, quoteId: null }))[0]!.deductedInId).toBeNull();

    const again = await invoices.createInvoiceFromOrder(s.ctx, o.id);
    expect(Number((await invoices.getInvoice(s.ctx, again.id)).total)).toBe(94400);
    await s.issue(again.id);
    await invoices.cancelInvoice(s.ctx, again.id);
    expect((await depositsOf(s.ctx, { orderId: o.id, quoteId: null }))[0]!.deductedInId).toBeNull();
  });

  it("les acomptes pris sur le devis suivent la commande issue de ce devis", async () => {
    const s = await setup();
    const q = await s.quote();
    const dep = await s.deposit("quote", q.id, "percent", 25);
    await s.issue(dep.id);
    const order = await quotes.convertQuoteToOrder(s.ctx, q.id);
    const final = await invoices.createInvoiceFromOrder(s.ctx, order.id);
    expect(Number((await invoices.getInvoice(s.ctx, final.id)).total)).toBe(88500); // 118 000 − 29 500
  });

  it("limite les acomptes : 100 % interdit, cumul au total interdit, source invalide refusée", async () => {
    const s = await setup();
    const q = await s.quote();
    await expect(s.deposit("quote", q.id, "percent", 100)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await s.deposit("quote", q.id, "percent", 60);
    await expect(s.deposit("quote", q.id, "percent", 40)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await s.deposit("quote", q.id, "percent", 30); // cumul 90 % : accepté

    const rejected = await s.quote();
    await quotes.setQuoteStatus(s.ctx, { id: rejected.id, status: "REJECTED" });
    await expect(s.deposit("quote", rejected.id, "percent", 10)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const draftOrder = await orders.createOrder(s.ctx, orderSchema.parse({ customerId: s.customer.id, orderDate: today(), lines: [s.line()] }));
    await expect(s.deposit("order", draftOrder.id, "percent", 10)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("une facture finale qui ne couvre pas les acomptes ne les déduit pas (ils restent pour la suivante)", async () => {
    const s = await setup();
    const o = await s.order([s.line({ quantity: 2 }), s.line({ quantity: 2, description: "Autre" })]); // 236 000 TTC
    const dep = await s.deposit("order", o.id, "percent", 50); // 118 000 TTC
    await s.issue(dep.id);
    const link = { orderId: o.id, quoteId: null };
    // facture partielle de 100 000 TTC < acompte : aucune déduction
    expect(await deductionFor(s.ctx.db, s.company.id, link, "XOF", d(100000), 1)).toBeNull();
    // facture de 118 000 TTC (couvre l'acompte exactement) : déduction qui donne un total nul → refusée aussi ; au-delà : acceptée
    expect(await deductionFor(s.ctx.db, s.company.id, link, "XOF", d(118000), 1)).toBeNull();
    const ok = await deductionFor(s.ctx.db, s.company.id, link, "XOF", d(150000), 1);
    expect(ok?.total.toNumber()).toBe(-118000);
    expect(ok?.depositIds).toEqual([dep.id]);
  });
});
