"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import * as inv from "./invoices";
import * as ord from "./orders";
import * as pay from "./payments";
import * as qt from "./quotes";
import {
  creditNoteSchema, deliverySchema, idSchema, invoiceSchema, issueInvoiceSchema, orderSchema, paymentSchema, quoteSchema, quoteStatusSchema, reminderSchema,
  updateInvoiceSchema, updateOrderSchema, updateQuoteSchema,
} from "./schemas";
import { z } from "zod";

const bust = () => { revalidatePath("/app/sales", "layout"); revalidatePath("/app/crm", "layout"); };
const M = "sales";

// Devis
export const createQuoteAction = defineTenantAction({ input: quoteSchema, module: M, permission: "sales.quote.create", handler: async ({ ctx, input }) => { const q = await qt.createQuote(ctx, input); bust(); return { id: q.id }; } });
export const updateQuoteAction = defineTenantAction({ input: updateQuoteSchema, module: M, permission: "sales.quote.update", handler: async ({ ctx, input }) => { await qt.updateQuote(ctx, input); bust(); } });
export const setQuoteStatusAction = defineTenantAction({ input: quoteStatusSchema, module: M, permission: "sales.quote.update", handler: async ({ ctx, input }) => { await qt.setQuoteStatus(ctx, input); bust(); } });
export const deleteQuoteAction = defineTenantAction({ input: idSchema, module: M, permission: "sales.quote.delete", handler: async ({ ctx, input }) => { await qt.deleteQuote(ctx, input.id); bust(); } });
export const convertQuoteToOrderAction = defineTenantAction({ input: idSchema, module: M, permission: ["sales.quote.update", "sales.order.create"], handler: async ({ ctx, input }) => { const o = await qt.convertQuoteToOrder(ctx, input.id); bust(); return { id: o.id }; } });
export const convertQuoteToInvoiceAction = defineTenantAction({ input: idSchema, module: M, permission: ["sales.quote.update", "finance.invoice.create"], handler: async ({ ctx, input }) => { const i = await qt.convertQuoteToInvoice(ctx, input.id); bust(); return { id: i.id }; } });

// Commandes et livraisons
export const createOrderAction = defineTenantAction({ input: orderSchema, module: M, permission: "sales.order.create", handler: async ({ ctx, input }) => { const o = await ord.createOrder(ctx, input); bust(); return { id: o.id }; } });
export const updateOrderAction = defineTenantAction({ input: updateOrderSchema, module: M, permission: "sales.order.update", handler: async ({ ctx, input }) => { await ord.updateOrder(ctx, input); bust(); } });
export const confirmOrderAction = defineTenantAction({ input: idSchema, module: M, permission: "sales.order.update", handler: async ({ ctx, input }) => { await ord.confirmOrder(ctx, input.id); bust(); } });
export const cancelOrderAction = defineTenantAction({ input: idSchema, module: M, permission: "sales.order.update", handler: async ({ ctx, input }) => { await ord.cancelOrder(ctx, input.id); bust(); } });
export const deleteOrderAction = defineTenantAction({ input: idSchema, module: M, permission: "sales.order.delete", handler: async ({ ctx, input }) => { await ord.deleteOrder(ctx, input.id); bust(); } });
export const createDeliveryAction = defineTenantAction({ input: deliverySchema, module: M, permission: "sales.delivery.create", handler: async ({ ctx, input }) => { const d = await ord.createDelivery(ctx, input); bust(); return { id: d.id }; } });
export const confirmDeliveryAction = defineTenantAction({ input: idSchema, module: M, permission: "sales.delivery.update", handler: async ({ ctx, input }) => { await ord.confirmDelivery(ctx, input.id); bust(); } });
export const deleteDeliveryAction = defineTenantAction({ input: idSchema, module: M, permission: "sales.delivery.update", handler: async ({ ctx, input }) => { await ord.deleteDelivery(ctx, input.id); bust(); } });

// Factures
export const createInvoiceAction = defineTenantAction({ input: invoiceSchema, module: M, permission: "finance.invoice.create", handler: async ({ ctx, input }) => { const i = await inv.createInvoice(ctx, input); bust(); return { id: i.id }; } });
export const updateInvoiceAction = defineTenantAction({ input: updateInvoiceSchema, module: M, permission: "finance.invoice.update", handler: async ({ ctx, input }) => { await inv.updateInvoice(ctx, input); bust(); } });
export const deleteInvoiceAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.invoice.delete", handler: async ({ ctx, input }) => { await inv.deleteInvoice(ctx, input.id); bust(); } });
export const invoiceFromOrderAction = defineTenantAction({ input: z.object({ id: z.string().uuid(), onlyDelivered: z.boolean().default(false) }), module: M, permission: ["sales.order.read", "finance.invoice.create"], handler: async ({ ctx, input }) => { const i = await inv.createInvoiceFromOrder(ctx, input.id, { onlyDelivered: input.onlyDelivered }); bust(); return { id: i.id }; } });
export const issueInvoiceAction = defineTenantAction({ input: issueInvoiceSchema, module: M, permission: "finance.invoice.update", handler: async ({ ctx, input }) => { const i = await inv.issueInvoice(ctx, input); bust(); return { number: i.number }; } });
export const cancelInvoiceAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.invoice.delete", handler: async ({ ctx, input }) => { await inv.cancelInvoice(ctx, input.id); bust(); } });
export const remindInvoiceAction = defineTenantAction({ input: reminderSchema, module: M, permission: "finance.invoice.update", handler: async ({ ctx, input }) => { await inv.remindInvoice(ctx, input); bust(); } });

// Avoirs
export const createCreditNoteAction = defineTenantAction({ input: creditNoteSchema, module: M, permission: "finance.credit_note.create", handler: async ({ ctx, input }) => { const c = await inv.createCreditNote(ctx, input); bust(); return { id: c.id }; } });
export const issueCreditNoteAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.credit_note.update", handler: async ({ ctx, input }) => { await inv.issueCreditNote(ctx, input.id); bust(); } });
export const deleteCreditNoteAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.credit_note.update", handler: async ({ ctx, input }) => { await inv.deleteCreditNote(ctx, input.id); bust(); } });

// Paiements
export const recordPaymentAction = defineTenantAction({ input: paymentSchema, module: M, permission: "finance.payment.create", handler: async ({ ctx, input }) => { const p = await pay.recordPayment(ctx, input); bust(); return { id: p.id, status: p.status }; } });
export const validatePaymentAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.payment.validate", handler: async ({ ctx, input }) => { await pay.validatePayment(ctx, input.id); bust(); } });
export const cancelPaymentAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.payment.create", handler: async ({ ctx, input }) => { await pay.cancelPayment(ctx, input.id); bust(); } });
