import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const dateStr = z.string().min(8, "Date requise");
const optDate = z.string().optional().or(z.literal(""));

import { linesSchema } from "@/core/documents/line-schema";
export { lineSchema, linesSchema, type LineInput, type LineOutput } from "@/core/documents/line-schema";

export const quoteSchema = z.object({
  kind: z.enum(["QUOTE", "PROFORMA"]).default("QUOTE"),
  customerId: uuid,
  opportunityId: emptyOr(uuid).optional(),
  issueDate: dateStr,
  validUntil: optDate,
  notes: text(3000),
  terms: text(3000),
  lines: linesSchema,
});
export type QuoteInput = z.input<typeof quoteSchema>;
export const updateQuoteSchema = quoteSchema.extend({ id: uuid });
export const quoteStatusSchema = z.object({ id: uuid, status: z.enum(["SENT", "ACCEPTED", "REJECTED", "DRAFT"]) });

export const orderSchema = z.object({
  customerId: uuid,
  orderDate: dateStr,
  expectedDelivery: optDate,
  warehouseId: emptyOr(uuid).optional(),
  notes: text(3000),
  lines: linesSchema,
});
export type OrderInput = z.input<typeof orderSchema>;
export const updateOrderSchema = orderSchema.extend({ id: uuid });

export const deliverySchema = z.object({
  orderId: uuid,
  warehouseId: emptyOr(uuid).optional(),
  deliveryDate: dateStr,
  notes: text(1000),
  lines: z.array(z.object({ orderLineId: uuid, quantity: z.coerce.number().min(0).max(1e9) })).min(1),
});

export const invoiceSchema = z.object({
  customerId: uuid,
  issueDate: dateStr,
  dueDate: optDate,
  notes: text(3000),
  terms: text(3000),
  costCenterId: emptyOr(uuid).optional(),
  branchId: emptyOr(uuid).optional(),
  projectId: emptyOr(uuid).optional(),
  lines: linesSchema,
});
export type InvoiceInput = z.input<typeof invoiceSchema>;
export const updateInvoiceSchema = invoiceSchema.extend({ id: uuid });
export const issueInvoiceSchema = z.object({ id: uuid, installments: z.coerce.number().int().min(1).max(24).default(1), allowOverLimit: z.boolean().default(false) });

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Espèces" }, { value: "BANK_TRANSFER", label: "Virement" }, { value: "CHEQUE", label: "Chèque" },
  { value: "MOBILE_MONEY", label: "Mobile money" }, { value: "CARD", label: "Carte" }, { value: "OTHER", label: "Autre" },
] as const;
export const paymentSchema = z.object({
  invoiceId: uuid,
  amount: z.coerce.number().positive("Montant > 0").max(1e13),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "MOBILE_MONEY", "CARD", "OTHER"]),
  date: dateStr,
  reference: text(100),
  accountId: emptyOr(uuid).optional(),
  notes: text(500),
});
export const idSchema = z.object({ id: uuid });

export const creditNoteSchema = z.object({
  invoiceId: uuid,
  reason: z.string().trim().min(3, "Motif requis").max(500),
  restock: z.boolean().default(false),
  lines: z.array(z.object({ invoiceLineId: uuid, quantity: z.coerce.number().min(0).max(1e9) })).min(1),
});

export const reminderSchema = z.object({ invoiceId: uuid, channel: z.enum(["EMAIL", "PHONE", "MANUAL"]), note: text(500) });
