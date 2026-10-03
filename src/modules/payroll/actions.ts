"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { employeeItemSchema, idSchema, payRunSchema, payrollItemSchema, runSchema, toggleItemSchema } from "./schemas";
import * as svc from "./service";

const bust = () => { revalidatePath("/app/payroll", "layout"); revalidatePath("/app/hr", "layout"); revalidatePath("/app/finance", "layout"); revalidatePath("/app/accounting", "layout"); };
const M = "payroll";
const P = "hr.payroll.manage";

export const saveItemAction = defineTenantAction({ input: payrollItemSchema, module: M, permission: P, handler: async ({ ctx, input }) => { await svc.saveItem(ctx, input); bust(); } });
export const toggleItemAction = defineTenantAction({ input: toggleItemSchema, module: M, permission: P, handler: async ({ ctx, input }) => { await svc.toggleItem(ctx, input.id, input.isActive); bust(); } });
export const installSampleItemsAction = defineTenantAction({ input: idSchema.partial(), module: M, permission: P, handler: async ({ ctx }) => { await svc.installSampleItems(ctx); bust(); } });
export const addEmployeeItemAction = defineTenantAction({ input: employeeItemSchema, module: M, permission: P, handler: async ({ ctx, input }) => { await svc.addEmployeeItem(ctx, input); bust(); } });
export const removeEmployeeItemAction = defineTenantAction({ input: idSchema, module: M, permission: P, handler: async ({ ctx, input }) => { await svc.removeEmployeeItem(ctx, input.id); bust(); } });

export const createRunAction = defineTenantAction({ input: runSchema, module: M, permission: P, handler: async ({ ctx, input }) => { const r = await svc.createRun(ctx, input); bust(); return { id: r.run.id, skipped: r.skipped }; } });
export const recalculateRunAction = defineTenantAction({ input: idSchema, module: M, permission: P, handler: async ({ ctx, input }) => { const r = await svc.recalculateRun(ctx, input.id); bust(); return r; } });
export const validateRunAction = defineTenantAction({ input: idSchema, module: M, permission: P, handler: async ({ ctx, input }) => { await svc.validateRun(ctx, input.id); bust(); } });
export const payRunAction = defineTenantAction({ input: payRunSchema, module: M, permission: P, handler: async ({ ctx, input }) => { await svc.payRun(ctx, input); bust(); } });
export const cancelRunAction = defineTenantAction({ input: idSchema, module: M, permission: P, handler: async ({ ctx, input }) => { await svc.cancelRun(ctx, input.id); bust(); } });
