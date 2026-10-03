import { describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { setCompanyModule } from "@/modules/platform/companies";
import * as crm from "@/modules/crm/service";
import { customerSchema } from "@/modules/crm/schemas";
import * as inv from "@/modules/inventory/service";
import { productSchema } from "@/modules/inventory/schemas";
import * as invoices from "@/modules/sales/invoices";
import * as orders from "@/modules/sales/orders";
import * as payments from "@/modules/sales/payments";
import * as quotes from "@/modules/sales/quotes";
import type { LineInput } from "@/modules/sales/schemas";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function setup(plan = "enterprise") {
  const co = await makeCompany("VENTES", plan);
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = (await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } }));
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Client Test", email: "client@test.ci", paymentTermsDays: 30 }));
  const wh = (await inv.listWarehouses(ctx))[0]!;
  const product = await inv.createProduct(ctx, productSchema.parse({ name: "Ciment", type: "GOODS", unit: "sac", salePrice: 6500, costPrice: 5000, trackStock: true, minStock: 0, openingWarehouseId: wh.id, openingQuantity: 100 }));
  const line = (over: Partial<LineInput> = {}): LineInput => ({ productId: product.id, description: "Ciment 50 kg", unit: "sac", quantity: 10, unitPrice: 6500, discountPct: 0, taxId: tax.id, ...over });
  const stock = async () => Number((await ctx.db.stockLevel.aggregate({ where: { productId: product.id }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  const reserved = async () => Number((await ctx.db.stockLevel.aggregate({ where: { productId: product.id }, _sum: { reserved: true } }))._sum.reserved ?? 0);
  return { ...co, ctx, tax, customer, wh, product, line, stock, reserved };
}
type S = Awaited<ReturnType<typeof setup>>;

const quoteInput = (s: S, lines: LineInput[], over = {}) => ({ kind: "QUOTE" as const, customerId: s.customer.id, issueDate: today(), validUntil: "", notes: "", terms: "", lines, ...over });
const parsed = async (s: S, lines: LineInput[], over = {}) => (await import("@/modules/sales/schemas")).quoteSchema.parse(quoteInput(s, lines, over));
const newQuote = async (s: S, lines: LineInput[] = [s.line()], over = {}) => quotes.createQuote(s.ctx, await parsed(s, lines, over));

describe("devis", () => {
  it("calcule les totaux côté serveur, numérote DEV-année-00001 et lit la taxe en base", async () => {
    const s = await setup();
    const q = await newQuote(s, [s.line({ quantity: 3, unitPrice: 10000, discountPct: 10 }), s.line({ quantity: 1, unitPrice: 5000, taxId: "" })]);
    expect(q.number).toBe(`DEV-${new Date().getFullYear()}-00001`);
    // ligne 1 : 30000 − 10 % = 27000 HT, TVA 18 % = 4860 ; ligne 2 : 5000 sans taxe
    expect(Number(q.subtotal)).toBe(35000);
    expect(Number(q.discountTotal)).toBe(3000);
    expect(Number(q.taxTotal)).toBe(4860);
    expect(Number(q.total)).toBe(36860);
    const full = await quotes.getQuote(s.ctx, q.id);
    expect(full.lines).toHaveLength(2);
    expect(Number(full.lines[0]!.taxRate)).toBe(18);
    expect(full.validUntil).not.toBeNull();
    const q2 = await newQuote(s);
    expect(q2.number.endsWith("00002")).toBe(true);
  });

  it("refuse produit, taxe ou client d'une autre entreprise, et lignes invalides", async () => {
    const A = await setup();
    const B = await setup();
    await expect(newQuote(A, [A.line({ productId: B.product.id })])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newQuote(A, [A.line({ taxId: B.tax.id })])).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(quotes.createQuote(A.ctx, await parsed(A, [A.line()], { customerId: B.customer.id }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { quoteSchema } = await import("@/modules/sales/schemas");
    expect(quoteSchema.safeParse(quoteInput(A, [])).success).toBe(false);
    expect(quoteSchema.safeParse(quoteInput(A, [A.line({ quantity: 0 })])).success).toBe(false);
    expect(quoteSchema.safeParse(quoteInput(A, [A.line({ discountPct: 150 })])).success).toBe(false);
  });

  it("workflow de statuts, modification et suppression", async () => {
    const s = await setup();
    const q = await newQuote(s);
    await quotes.setQuoteStatus(s.ctx, { id: q.id, status: "SENT" });
    await quotes.setQuoteStatus(s.ctx, { id: q.id, status: "ACCEPTED" });
    await expect(quotes.deleteQuote(s.ctx, q.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(quotes.updateQuote(s.ctx, { ...(await parsed(s, [s.line()])), id: q.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const d = await newQuote(s);
    await quotes.updateQuote(s.ctx, { ...(await parsed(s, [s.line({ quantity: 2 })])), id: d.id });
    expect(Number((await quotes.getQuote(s.ctx, d.id)).total)).toBe(15340);
    await quotes.deleteQuote(s.ctx, d.id);
    await expect(quotes.getQuote(s.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un devis dont la validité est dépassée est expiré : ni acceptation ni conversion", async () => {
    const s = await setup();
    const q = await newQuote(s, [s.line()], { issueDate: daysAgo(60), validUntil: daysAgo(10) });
    expect(quotes.effectiveQuoteStatus(await quotes.getQuote(s.ctx, q.id))).toBe("EXPIRED");
    await expect(quotes.setQuoteStatus(s.ctx, { id: q.id, status: "ACCEPTED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(quotes.convertQuoteToOrder(s.ctx, q.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await quotes.listQuotes(s.ctx, { status: "EXPIRED", skip: 0, take: 10 })).rows.map((r) => r.id)).toContain(q.id);
  });
});

describe("parcours complet : devis → commande → livraison → facture → paiement", () => {
  it("transforme sans ressaisie, met à jour stock, statuts et soldes à chaque étape", async () => {
    const s = await setup();
    const { ctx } = s;
    // devis → commande (réserve le stock)
    const q = await newQuote(s, [s.line({ quantity: 10 })]);
    const o = await quotes.convertQuoteToOrder(ctx, q.id);
    expect(o).toMatchObject({ status: "CONFIRMED" });
    expect(o.number).toBe(`CMD-${new Date().getFullYear()}-00001`);
    expect((await quotes.getQuote(ctx, q.id)).status).toBe("CONVERTED");
    await expect(quotes.convertQuoteToOrder(ctx, q.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(await s.reserved()).toBe(10);
    expect(await s.stock()).toBe(100);

    // livraison partielle (4) puis solde (6)
    const order = await orders.getOrder(ctx, o.id);
    const ol = order.lines[0]!;
    const d1 = await orders.createDelivery(ctx, { orderId: o.id, warehouseId: s.wh.id, deliveryDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 4 }] });
    await expect(orders.createDelivery(ctx, { orderId: o.id, warehouseId: s.wh.id, deliveryDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 7 }] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await orders.confirmDelivery(ctx, d1.id);
    expect(await s.stock()).toBe(96);
    expect(await s.reserved()).toBe(6);
    expect((await orders.getOrder(ctx, o.id)).status).toBe("PARTIALLY_DELIVERED");
    await expect(orders.confirmDelivery(ctx, d1.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const d2 = await orders.createDelivery(ctx, { orderId: o.id, warehouseId: s.wh.id, deliveryDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 6 }] });
    await orders.confirmDelivery(ctx, d2.id);
    expect(await s.stock()).toBe(90);
    expect(await s.reserved()).toBe(0);
    expect((await orders.getOrder(ctx, o.id)).status).toBe("DELIVERED");
    const mv = await inv.listMovements(ctx, { productId: s.product.id, type: "OUT", skip: 0, take: 10 });
    expect(mv.rows.map((m) => m.reference).sort()).toEqual([d1.number, d2.number].sort());

    // commande → facture (brouillon sans numéro) → émission
    const draft = await invoices.createInvoiceFromOrder(ctx, o.id);
    expect(draft).toMatchObject({ status: "DRAFT", number: null });
    expect(Number(draft.total)).toBe(76700); // 10 × 6500 = 65000 HT + 18 % = 76700
    const issued = await invoices.issueInvoice(ctx, { id: draft.id, installments: 1, allowOverLimit: false });
    expect(issued.number).toBe(`FAC-${new Date().getFullYear()}-00001`);
    expect(issued.status).toBe("ISSUED");
    expect((await orders.getOrder(ctx, o.id)).status).toBe("INVOICED");
    await expect(invoices.issueInvoice(ctx, { id: draft.id, installments: 1, allowOverLimit: false })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(invoices.createInvoiceFromOrder(ctx, o.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await invoices.customerBalance(ctx, s.customer.id)).outstanding.toNumber()).toBe(76700);

    // paiements partiel puis total
    const p1 = await payments.recordPayment(ctx, { invoiceId: draft.id, amount: 30000, method: "BANK_TRANSFER", date: today() } as never);
    expect(p1.status).toBe("VALIDATED");
    expect((await invoices.getInvoice(ctx, draft.id)).status).toBe("PARTIALLY_PAID");
    await expect(payments.recordPayment(ctx, { invoiceId: draft.id, amount: 50000, method: "CASH", date: today() } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await payments.recordPayment(ctx, { invoiceId: draft.id, amount: 46700, method: "CASH", date: today() } as never);
    const paid = await invoices.getInvoice(ctx, draft.id);
    expect(paid.status).toBe("PAID");
    expect(invoices.invoiceBalance(paid).toNumber()).toBe(0);
    expect((await invoices.customerBalance(ctx, s.customer.id)).outstanding.toNumber()).toBe(0);
    await expect(payments.recordPayment(ctx, { invoiceId: draft.id, amount: 1, method: "CASH", date: today() } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(paid.payments.map((p) => p.number).every((n) => /^REC-\d{4}-\d{5}$/.test(n))).toBe(true);
  });

  it("devis → facture directe, sans ressaisie ; supprimer le brouillon réactive le devis", async () => {
    const s = await setup();
    const q = await newQuote(s, [s.line({ quantity: 2 }), s.line({ description: "Transport", productId: "", quantity: 1, unitPrice: 20000 })]);
    const draft = await quotes.convertQuoteToInvoice(s.ctx, q.id);
    expect(Number(draft.total)).toBe(Number(q.total));
    expect((await invoices.getInvoice(s.ctx, draft.id)).lines).toHaveLength(2);
    expect((await quotes.getQuote(s.ctx, q.id)).status).toBe("CONVERTED");
    await invoices.deleteInvoice(s.ctx, draft.id);
    expect((await quotes.getQuote(s.ctx, q.id)).status).toBe("ACCEPTED");
  });

  it("stock insuffisant à la livraison : TOUT est annulé (commande, lignes, statut)", async () => {
    const s = await setup();
    const q = await newQuote(s, [s.line({ quantity: 10 })]);
    const o = await quotes.convertQuoteToOrder(s.ctx, q.id);
    const ol = (await orders.getOrder(s.ctx, o.id)).lines[0]!;
    const dl = await orders.createDelivery(s.ctx, { orderId: o.id, warehouseId: s.wh.id, deliveryDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 10 }] });
    // le stock disparaît entre-temps
    await inv.manualMovement(s.ctx, { kind: "OUT", productId: s.product.id, warehouseId: s.wh.id, quantity: 95 } as never);
    await expect(orders.confirmDelivery(s.ctx, dl.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Stock insuffisant") });
    expect((await orders.getDelivery(s.ctx, dl.id)).status).toBe("DRAFT");
    const after = await orders.getOrder(s.ctx, o.id);
    expect(Number(after.lines[0]!.deliveredQty)).toBe(0);
    expect(after.status).toBe("CONFIRMED");
    expect(await s.stock()).toBe(5);
  });

  it("commande : réservation refusée si le disponible est insuffisant ; annulation libère le stock", async () => {
    const s = await setup();
    const big = await orders.createOrder(s.ctx, (await import("@/modules/sales/schemas")).orderSchema.parse({ customerId: s.customer.id, orderDate: today(), lines: [s.line({ quantity: 150 })] }));
    await expect(orders.confirmOrder(s.ctx, big.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await orders.getOrder(s.ctx, big.id)).status).toBe("DRAFT");
    expect(await s.reserved()).toBe(0);
    const q = await newQuote(s, [s.line({ quantity: 30 })]);
    const o = await quotes.convertQuoteToOrder(s.ctx, q.id);
    expect(await s.reserved()).toBe(30);
    await orders.cancelOrder(s.ctx, o.id);
    expect(await s.reserved()).toBe(0);
    expect((await orders.getOrder(s.ctx, o.id)).status).toBe("CANCELLED");
  });

  it("sans le module Stock, la livraison ne touche pas au stock", async () => {
    const s = await setup();
    await setCompanyModule(s.company.id, "inventory", false);
    const ctx = await ctxFor(s.owner.id, s.company.id);
    const q = await quotes.createQuote(ctx, await parsed(s, [s.line({ quantity: 10 })]));
    const o = await quotes.convertQuoteToOrder(ctx, q.id);
    expect(await s.reserved()).toBe(0);
    const ol = (await orders.getOrder(ctx, o.id)).lines[0]!;
    const dl = await orders.createDelivery(ctx, { orderId: o.id, warehouseId: "", deliveryDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 10 }] });
    await orders.confirmDelivery(ctx, dl.id);
    expect(await s.stock()).toBe(100);
    expect((await orders.getOrder(ctx, o.id)).status).toBe("DELIVERED");
  });
});

describe("factures", () => {
  const issued = async (s: S, qty = 10, opts: { installments?: number } = {}) => {
    const q = await newQuote(s, [s.line({ quantity: qty })]);
    const draft = await quotes.convertQuoteToInvoice(s.ctx, q.id);
    return invoices.issueInvoice(s.ctx, { id: draft.id, installments: opts.installments ?? 1, allowOverLimit: false });
  };

  it("numérotation sans trou à l'émission (les brouillons n'ont pas de numéro)", async () => {
    const s = await setup();
    const a = await newQuote(s); const b = await newQuote(s);
    const d1 = await quotes.convertQuoteToInvoice(s.ctx, a.id);
    const d2 = await quotes.convertQuoteToInvoice(s.ctx, b.id);
    const i2 = await invoices.issueInvoice(s.ctx, { id: d2.id, installments: 1, allowOverLimit: false });
    const i1 = await invoices.issueInvoice(s.ctx, { id: d1.id, installments: 1, allowOverLimit: false });
    expect([i2.number, i1.number]).toEqual([`FAC-${new Date().getFullYear()}-00001`, `FAC-${new Date().getFullYear()}-00002`]);
  });

  it("échéancier : N échéances dont la somme est exacte ; les paiements s'imputent dans l'ordre", async () => {
    const s = await setup();
    const inv1 = await issued(s, 10, { installments: 3 });
    const full = await invoices.getInvoice(s.ctx, inv1.id);
    expect(full.installments.map((i) => Number(i.amount))).toEqual([25567, 25567, 25566]);
    expect(full.installments.reduce((a, i) => a + Number(i.amount), 0)).toBe(Number(full.total));
    await payments.recordPayment(s.ctx, { invoiceId: inv1.id, amount: 30000, method: "CASH", date: today() } as never);
    const after = await invoices.getInvoice(s.ctx, inv1.id);
    expect(after.installments.map((i) => Number(i.paidAmount))).toEqual([25567, 4433, 0]);
  });

  it("une facture émise n'est plus modifiable ; annulation seulement sans paiement ; commande dé-facturée", async () => {
    const s = await setup();
    const q = await newQuote(s, [s.line({ quantity: 5 })]);
    const o = await quotes.convertQuoteToOrder(s.ctx, q.id);
    const draft = await invoices.createInvoiceFromOrder(s.ctx, o.id);
    const i = await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
    expect((await orders.getOrder(s.ctx, o.id)).status).toBe("INVOICED");
    await expect(invoices.updateInvoice(s.ctx, { ...(await import("@/modules/sales/schemas")).invoiceSchema.parse({ customerId: s.customer.id, issueDate: today(), lines: [s.line()] }), id: i.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(invoices.deleteInvoice(s.ctx, i.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const pay = await payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 1000, method: "CASH", date: today() } as never);
    await expect(invoices.cancelInvoice(s.ctx, i.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await payments.cancelPayment(s.ctx, pay.id);
    await invoices.cancelInvoice(s.ctx, i.id);
    expect((await invoices.getInvoice(s.ctx, i.id)).status).toBe("CANCELLED");
    expect(Number((await orders.getOrder(s.ctx, o.id)).lines[0]!.invoicedQty)).toBe(0);
    expect((await orders.getOrder(s.ctx, o.id)).status).toBe("CONFIRMED");
    await expect(payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 100, method: "CASH", date: today() } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("plafond de crédit : bloque l'émission, sauf dérogation d'un valideur", async () => {
    const s = await setup();
    await crm.updateCustomer(s.ctx, { ...customerSchema.parse({ type: "COMPANY", name: "Client Test", paymentTermsDays: 30, creditLimit: 100000 }), id: s.customer.id, isActive: true });
    const first = await issued(s, 10); // 76 700
    expect(first.status).toBe("ISSUED");
    const q = await newQuote(s, [s.line({ quantity: 10 })]);
    const draft = await quotes.convertQuoteToInvoice(s.ctx, q.id);
    await expect(invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Plafond de crédit") });
    // un simple commercial ne peut pas outrepasser
    const rep = await addMember(s.company.id, "sales_rep");
    const repCtx = await ctxFor(rep.user.id, s.company.id);
    await expect(invoices.issueInvoice(repCtx, { id: draft.id, installments: 1, allowOverLimit: true })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: true })).status).toBe("ISSUED");
  });

  it("facture échue, solde client et relances", async () => {
    const s = await setup();
    const q = await newQuote(s, [s.line({ quantity: 10 })], { issueDate: daysAgo(60) });
    const draft = await quotes.convertQuoteToInvoice(s.ctx, q.id);
    await platformDb.invoice.update({ where: { id: draft.id }, data: { issueDate: new Date(Date.now() - 60 * 86_400_000), dueDate: new Date(Date.now() - 20 * 86_400_000) } });
    const i = await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
    const full = await invoices.getInvoice(s.ctx, i.id);
    expect(invoices.isOverdue(full)).toBe(true);
    const bal = await invoices.customerBalance(s.ctx, s.customer.id);
    expect(bal.overdue.toNumber()).toBe(76700);
    expect((await invoices.listInvoices(s.ctx, { status: "OVERDUE", skip: 0, take: 10 })).rows.map((r) => r.id)).toContain(i.id);
    expect((await invoices.overdueInvoices(s.ctx)).map((r) => r.id)).toContain(i.id);

    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await invoices.remindInvoice(s.ctx, { invoiceId: i.id, channel: "EMAIL", note: "" });
    await invoices.remindInvoice(s.ctx, { invoiceId: i.id, channel: "PHONE", note: "Appel client" });
    const sent = log.mock.calls.map((c) => String(c[0])).join("\n");
    log.mockRestore();
    expect(sent).toContain(`Facture ${i.number} échue`);
    expect((await invoices.getInvoice(s.ctx, i.id)).reminders.map((r) => r.level).sort()).toEqual([1, 2]);

    await payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 76700, method: "CASH", date: today() } as never);
    expect((await invoices.customerBalance(s.ctx, s.customer.id)).overdue.toNumber()).toBe(0);
    await expect(invoices.remindInvoice(s.ctx, { invoiceId: i.id, channel: "PHONE", note: "" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("paiements", () => {
  const issuedInvoice = async (s: S, qty = 10) => {
    const q = await newQuote(s, [s.line({ quantity: qty })]);
    const draft = await quotes.convertQuoteToInvoice(s.ctx, q.id);
    return invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
  };

  it("CONCURRENCE : 6 paiements simultanés de 40 % → jamais plus que le solde", async () => {
    const s = await setup();
    const i = await issuedInvoice(s); // 76 700
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 30680, method: "CASH", date: today() } as never)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const after = await invoices.getInvoice(s.ctx, i.id);
    expect(Number(after.amountPaid)).toBe(61360);
    expect(invoices.invoiceBalance(after).toNumber()).toBe(15340);
    expect(after.payments.filter((p) => p.status === "VALIDATED")).toHaveLength(2);
  });

  it("sans droit de validation : paiement « en attente », sans effet sur le solde, jusqu'à validation", async () => {
    const s = await setup();
    const i = await issuedInvoice(s);
    const rep = await addMember(s.company.id, "sales_rep");
    // le commercial peut enregistrer (finance.payment.create) mais pas valider
    const perms = await platformDb.permission.findMany({ where: { key: { in: ["finance.payment.create", "finance.payment.read", "finance.invoice.read"] } } });
    await platformDb.rolePermission.createMany({ data: perms.map((p) => ({ roleId: rep.role.id, companyId: s.company.id, permissionId: p.id })), skipDuplicates: true });
    const repCtx = await ctxFor(rep.user.id, s.company.id);
    const p = await payments.recordPayment(repCtx, { invoiceId: i.id, amount: 20000, method: "MOBILE_MONEY", date: today(), reference: "OM-123" } as never);
    expect(p.status).toBe("PENDING");
    expect(Number((await invoices.getInvoice(s.ctx, i.id)).amountPaid)).toBe(0);
    await expect(payments.validatePayment(repCtx, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await payments.validatePayment(s.ctx, p.id);
    const after = await invoices.getInvoice(s.ctx, i.id);
    expect(Number(after.amountPaid)).toBe(20000);
    expect(after.status).toBe("PARTIALLY_PAID");
    await expect(payments.cancelPayment(repCtx, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await payments.cancelPayment(s.ctx, p.id);
    const reverted = await invoices.getInvoice(s.ctx, i.id);
    expect(Number(reverted.amountPaid)).toBe(0);
    expect(reverted.status).toBe("ISSUED");
    expect(reverted.installments.every((x) => Number(x.paidAmount) === 0)).toBe(true);
    await expect(payments.cancelPayment(s.ctx, p.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe("avoirs", () => {
  const setupInvoice = async () => {
    const s = await setup();
    const q = await newQuote(s, [s.line({ quantity: 10 })]);
    const draft = await quotes.convertQuoteToInvoice(s.ctx, q.id);
    const i = await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
    const full = await invoices.getInvoice(s.ctx, i.id);
    return { s, i, lineId: full.lines[0]!.id };
  };

  it("avoir partiel : réduit le solde ; plafonné à la quantité facturée ; retour en stock", async () => {
    const { s, i, lineId } = await setupInvoice();
    await expect(invoices.createCreditNote(s.ctx, { invoiceId: i.id, reason: "Trop", restock: false, lines: [{ invoiceLineId: lineId, quantity: 11 }] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const cn = await invoices.createCreditNote(s.ctx, { invoiceId: i.id, reason: "Marchandise retournée", restock: true, lines: [{ invoiceLineId: lineId, quantity: 4 }] });
    expect(cn.status).toBe("DRAFT");
    expect(Number(cn.total)).toBe(30680); // 4 × 6500 = 26000 + 18 %
    const stockBefore = await s.stock();
    const issued = await invoices.issueCreditNote(s.ctx, cn.id);
    expect(issued.number).toBe(`AV-${new Date().getFullYear()}-00001`);
    const after = await invoices.getInvoice(s.ctx, i.id);
    expect(Number(after.creditedAmount)).toBe(30680);
    expect(invoices.invoiceBalance(after).toNumber()).toBe(46020);
    expect(await s.stock()).toBe(stockBefore + 4);
    await expect(invoices.createCreditNote(s.ctx, { invoiceId: i.id, reason: "Encore", restock: false, lines: [{ invoiceLineId: lineId, quantity: 7 }] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // crédit du solde restant → facture soldée
    const cn2 = await invoices.createCreditNote(s.ctx, { invoiceId: i.id, reason: "Reste", restock: false, lines: [{ invoiceLineId: lineId, quantity: 6 }] });
    await invoices.issueCreditNote(s.ctx, cn2.id);
    expect((await invoices.getInvoice(s.ctx, i.id)).status).toBe("PAID");
    await expect(invoices.issueCreditNote(s.ctx, cn2.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("avoir sur facture déjà payée → trop-perçu (crédit client) ; brouillon supprimable", async () => {
    const { s, i, lineId } = await setupInvoice();
    await payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 76700, method: "CASH", date: today() } as never);
    const cn = await invoices.createCreditNote(s.ctx, { invoiceId: i.id, reason: "Erreur de prix", restock: false, lines: [{ invoiceLineId: lineId, quantity: 2 }] });
    await invoices.issueCreditNote(s.ctx, cn.id);
    const bal = await invoices.customerBalance(s.ctx, s.customer.id);
    expect(bal.credit.toNumber()).toBe(15340);
    expect(bal.outstanding.toNumber()).toBe(0);
    const draft = await invoices.createCreditNote(s.ctx, { invoiceId: i.id, reason: "Brouillon", restock: false, lines: [{ invoiceLineId: lineId, quantity: 1 }] });
    await invoices.deleteCreditNote(s.ctx, draft.id);
  });
});

describe("ISOLATION des ventes", () => {
  it("aucun accès, paiement, avoir ou conversion sur les documents d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const qB = await newQuote(B, [B.line()]);
    const draftB = await quotes.convertQuoteToInvoice(B.ctx, (await newQuote(B, [B.line()])).id);
    const iB = await invoices.issueInvoice(B.ctx, { id: draftB.id, installments: 1, allowOverLimit: false });
    const oB = await quotes.convertQuoteToOrder(B.ctx, qB.id);
    const lineB = (await invoices.getInvoice(B.ctx, iB.id)).lines[0]!;

    await expect(quotes.getQuote(A.ctx, qB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(quotes.setQuoteStatus(A.ctx, { id: qB.id, status: "SENT" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(orders.getOrder(A.ctx, oB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(orders.confirmOrder(A.ctx, oB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invoices.getInvoice(A.ctx, iB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invoices.cancelInvoice(A.ctx, iB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(payments.recordPayment(A.ctx, { invoiceId: iB.id, amount: 100, method: "CASH", date: today() } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invoices.createCreditNote(A.ctx, { invoiceId: iB.id, reason: "Intrus", restock: false, lines: [{ invoiceLineId: lineB.id, quantity: 1 }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(invoices.remindInvoice(A.ctx, { invoiceId: iB.id, channel: "PHONE", note: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await invoices.listInvoices(A.ctx, { skip: 0, take: 50 })).total).toBe(0);
    expect((await payments.listPayments(A.ctx, { skip: 0, take: 50 })).total).toBe(0);
    expect(Number((await platformDb.invoice.findUniqueOrThrow({ where: { id: iB.id } })).amountPaid)).toBe(0);
    // les numéros sont propres à chaque entreprise
    expect(iB.number).toBe(`FAC-${new Date().getFullYear()}-00001`);
  });
});

describe("PDF des documents", () => {
  it("génère devis, commande, livraison, facture, avoir et reçu (accents, nombreuses lignes, pagination)", async () => {
    const { buildPdf } = await import("@/modules/sales/pdf");
    const s = await setup();
    const many = Array.from({ length: 45 }, (_, i) => s.line({ productId: "", description: `Article n°${i + 1} — éléments très résistants à l'humidité, œuvres d'ingénierie`, quantity: 1 + (i % 4), unitPrice: 1500 + i * 10 }));
    const q = await newQuote(s, many, { notes: "Livraison sous 5 jours ouvrés. Règlement à réception de facture.", terms: "Acompte de 30 % à la commande." });
    const o = await quotes.convertQuoteToOrder(s.ctx, q.id);
    const ol = (await orders.getOrder(s.ctx, o.id)).lines;
    const dl = await orders.createDelivery(s.ctx, { orderId: o.id, warehouseId: s.wh.id, deliveryDate: today(), notes: "", lines: ol.slice(0, 3).map((l) => ({ orderLineId: l.id, quantity: 1 })) });
    const draft = await invoices.createInvoiceFromOrder(s.ctx, o.id);
    const i = await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 3, allowOverLimit: false });
    const pay = await payments.recordPayment(s.ctx, { invoiceId: i.id, amount: 50000, method: "MOBILE_MONEY", date: today(), reference: "OM-77" } as never);
    const lineId = (await invoices.getInvoice(s.ctx, i.id)).lines[0]!.id;
    const cn = await invoices.createCreditNote(s.ctx, { invoiceId: i.id, reason: "Retour partiel", restock: false, lines: [{ invoiceLineId: lineId, quantity: 1 }] });
    const docs = [["quote", q.id], ["order", o.id], ["delivery", dl.id], ["invoice", i.id], ["invoice", draft.id], ["credit-note", cn.id], ["receipt", pay.id]] as const;
    for (const [kind, id] of docs) {
      const { data, filename } = await buildPdf(s.ctx, kind, id);
      expect(data.subarray(0, 5).toString(), kind).toBe("%PDF-");
      expect(data.length, kind).toBeGreaterThan(1500);
      expect(filename).toMatch(/\.pdf$/);
    }
    const quotePdf = (await buildPdf(s.ctx, "quote", q.id)).data.toString("latin1");
    expect((quotePdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1); // 45 lignes → plusieurs pages
  });

  it("un document d'une autre entreprise est introuvable", async () => {
    const { buildPdf } = await import("@/modules/sales/pdf");
    const A = await setup();
    const B = await setup();
    const qB = await newQuote(B);
    await expect(buildPdf(A.ctx, "quote", qB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
