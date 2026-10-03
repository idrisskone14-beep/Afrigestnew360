"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import * as bl from "./bills";
import * as pr from "./procurement";
import * as sp from "./suppliers";
import {
  billFromOrderSchema, idSchema, orderFromRequestSchema, purchaseOrderSchema, purchaseRequestSchema, receiptSchema, supplierBillSchema, supplierPaymentSchema, supplierSchema,
  updatePurchaseOrderSchema, updatePurchaseRequestSchema, updateSupplierBillSchema, updateSupplierSchema,
} from "./schemas";

const bust = () => { revalidatePath("/app/purchases", "layout"); revalidatePath("/app/validations"); revalidatePath("/app/inventory", "layout"); };
const M = "purchases";

// Fournisseurs
export const createSupplierAction = defineTenantAction({ input: supplierSchema, module: M, permission: "purchases.supplier.create", handler: async ({ ctx, input }) => { const s = await sp.createSupplier(ctx, input); bust(); return { id: s.id }; } });
export const updateSupplierAction = defineTenantAction({ input: updateSupplierSchema, module: M, permission: "purchases.supplier.update", handler: async ({ ctx, input }) => { await sp.updateSupplier(ctx, input); bust(); } });
export const archiveSupplierAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.supplier.delete", handler: async ({ ctx, input }) => { await sp.archiveSupplier(ctx, input.id); bust(); } });

// Demandes d'achat
export const createRequestAction = defineTenantAction({ input: purchaseRequestSchema, module: M, permission: "purchases.request.create", handler: async ({ ctx, input }) => { const r = await pr.createRequest(ctx, input); bust(); return { id: r.id }; } });
export const updateRequestAction = defineTenantAction({ input: updatePurchaseRequestSchema, module: M, permission: "purchases.request.create", handler: async ({ ctx, input }) => { await pr.updateRequest(ctx, input); bust(); } });
export const deleteRequestAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.request.create", handler: async ({ ctx, input }) => { await pr.deleteRequest(ctx, input.id); bust(); } });
export const submitRequestAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.request.create", handler: async ({ ctx, input }) => { const r = await pr.submitRequest(ctx, input.id); bust(); return r; } });
export const cancelRequestAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.request.create", handler: async ({ ctx, input }) => { await pr.cancelRequest(ctx, input.id); bust(); } });
export const convertRequestAction = defineTenantAction({ input: orderFromRequestSchema, module: M, permission: ["purchases.request.read", "purchases.order.create"], handler: async ({ ctx, input }) => { const o = await pr.convertRequestToOrder(ctx, input); bust(); return { id: o.id }; } });

// Commandes fournisseur
export const createOrderAction = defineTenantAction({ input: purchaseOrderSchema, module: M, permission: "purchases.order.create", handler: async ({ ctx, input }) => { const o = await pr.createOrder(ctx, input); bust(); return { id: o.id }; } });
export const updateOrderAction = defineTenantAction({ input: updatePurchaseOrderSchema, module: M, permission: "purchases.order.update", handler: async ({ ctx, input }) => { await pr.updateOrder(ctx, input); bust(); } });
export const deleteOrderAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.order.delete", handler: async ({ ctx, input }) => { await pr.deleteOrder(ctx, input.id); bust(); } });
export const submitOrderAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.order.update", handler: async ({ ctx, input }) => { const r = await pr.submitOrder(ctx, input.id); bust(); return r; } });
export const cancelOrderAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.order.update", handler: async ({ ctx, input }) => { await pr.cancelOrder(ctx, input.id); bust(); } });

// Réceptions
export const createReceiptAction = defineTenantAction({ input: receiptSchema, module: M, permission: "purchases.receipt.create", handler: async ({ ctx, input }) => { const r = await pr.createReceipt(ctx, input); bust(); return { id: r.id }; } });
export const confirmReceiptAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.receipt.create", handler: async ({ ctx, input }) => { await pr.confirmReceipt(ctx, input.id); bust(); } });
export const deleteReceiptAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.receipt.create", handler: async ({ ctx, input }) => { await pr.deleteReceipt(ctx, input.id); bust(); } });

// Factures fournisseur
export const createBillAction = defineTenantAction({ input: supplierBillSchema, module: M, permission: "purchases.bill.create", handler: async ({ ctx, input }) => { const b = await bl.createBill(ctx, input); bust(); return { id: b.id }; } });
export const updateBillAction = defineTenantAction({ input: updateSupplierBillSchema, module: M, permission: "purchases.bill.update", handler: async ({ ctx, input }) => { await bl.updateBill(ctx, input); bust(); } });
export const deleteBillAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.bill.update", handler: async ({ ctx, input }) => { await bl.deleteBill(ctx, input.id); bust(); } });
export const billFromOrderAction = defineTenantAction({ input: billFromOrderSchema, module: M, permission: ["purchases.order.read", "purchases.bill.create"], handler: async ({ ctx, input }) => { const b = await bl.createBillFromOrder(ctx, input.id, { onlyReceived: input.onlyReceived }); bust(); return { id: b.id }; } });
export const postBillAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.bill.approve", handler: async ({ ctx, input }) => { const b = await bl.postBill(ctx, input.id); bust(); return { number: b.number }; } });
export const cancelBillAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.bill.approve", handler: async ({ ctx, input }) => { await bl.cancelBill(ctx, input.id); bust(); } });

// Paiements fournisseurs
export const paySupplierBillAction = defineTenantAction({ input: supplierPaymentSchema, module: M, permission: "purchases.payment.create", handler: async ({ ctx, input }) => { const p = await bl.recordSupplierPayment(ctx, input); bust(); return { id: p.id, pendingApproval: p.status === "PENDING" }; } });
export const cancelSupplierPaymentAction = defineTenantAction({ input: idSchema, module: M, permission: "purchases.payment.create", handler: async ({ ctx, input }) => { await bl.cancelSupplierPayment(ctx, input.id); bust(); } });
