import { z } from "zod";
import { linesSchema } from "@/core/documents/line-schema";
import { COUNTRIES } from "@/lib/reference-data";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const dateStr = z.string().min(8, "Date requise");
const optDate = z.string().optional().or(z.literal(""));

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(150),
  email: z.string().trim().email("E-mail invalide").optional().or(z.literal("")),
  phone: text(40),
  address: text(250),
  city: text(100),
  country: z.string().refine((c) => c === "" || COUNTRIES.some((x) => x.code === c), "Pays invalide").optional(),
  taxId: text(60),
  rccm: text(60),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  notes: text(2000),
});
export type SupplierInput = z.input<typeof supplierSchema>;
export const updateSupplierSchema = supplierSchema.extend({ id: uuid, isActive: z.boolean().default(true) });
export const idSchema = z.object({ id: uuid });

export const requestLineSchema = z.object({
  productId: emptyOr(uuid).optional(),
  description: z.string().trim().min(1, "Désignation requise").max(500),
  unit: z.string().trim().max(20).default("unité"),
  quantity: z.coerce.number().positive("Quantité > 0").max(1e9),
  estimatedPrice: z.coerce.number().min(0).max(1e13).default(0),
});
export const purchaseRequestSchema = z.object({
  neededBy: optDate,
  reason: text(1000),
  lines: z.array(requestLineSchema).min(1, "Ajoutez au moins une ligne").max(100),
});
export const updatePurchaseRequestSchema = purchaseRequestSchema.extend({ id: uuid });
export type PurchaseRequestInput = z.input<typeof purchaseRequestSchema>;

export const purchaseOrderSchema = z.object({
  supplierId: uuid,
  orderDate: dateStr,
  expectedDate: optDate,
  warehouseId: emptyOr(uuid).optional(),
  notes: text(3000),
  lines: linesSchema,
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;
export const updatePurchaseOrderSchema = purchaseOrderSchema.extend({ id: uuid });
export const orderFromRequestSchema = z.object({ requestId: uuid, supplierId: uuid });

export const receiptSchema = z.object({
  orderId: uuid,
  warehouseId: emptyOr(uuid).optional(),
  receiptDate: dateStr,
  notes: text(1000),
  lines: z.array(z.object({ orderLineId: uuid, quantity: z.coerce.number().min(0).max(1e9) })).min(1),
});

export const supplierBillSchema = z.object({
  supplierId: uuid,
  supplierRef: text(60),
  billDate: dateStr,
  dueDate: optDate,
  notes: text(3000),
  costCenterId: emptyOr(uuid).optional(),
  branchId: emptyOr(uuid).optional(),
  projectId: emptyOr(uuid).optional(),
  lines: linesSchema,
});
export type SupplierBillInput = z.input<typeof supplierBillSchema>;
export const updateSupplierBillSchema = supplierBillSchema.extend({ id: uuid });
export const billFromOrderSchema = z.object({ id: uuid, onlyReceived: z.boolean().default(true) });

export const supplierPaymentSchema = z.object({
  billId: uuid,
  amount: z.coerce.number().positive("Montant > 0").max(1e13),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "MOBILE_MONEY", "CARD", "OTHER"]),
  date: dateStr,
  reference: text(100),
  accountId: emptyOr(uuid).optional(),
  notes: text(500),
});

export const decisionSchema = z.object({ id: uuid, decision: z.enum(["APPROVED", "REJECTED"]), comment: text(500) });
export const policySchema = z.object({ type: z.string().min(1), isEnabled: z.boolean(), threshold: z.coerce.number().min(0).max(1e13) });
