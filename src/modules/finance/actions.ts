"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import * as ex from "./expenses";
import * as rp from "./reports";
import {
  accountSchema, budgetSchema, categorySchema, expenseSchema, idSchema, manualTransactionSchema, payExpenseSchema, reconcileSchema, transferSchema,
  updateAccountSchema, updateCategorySchema, updateExpenseSchema,
} from "./schemas";
import * as tr from "./treasury";

const bust = () => { revalidatePath("/app/finance", "layout"); revalidatePath("/app/validations"); };
const M = "finance";

// Comptes
export const createAccountAction = defineTenantAction({ input: accountSchema, module: M, permission: "finance.account.manage", handler: async ({ ctx, input }) => { const a = await tr.createAccount(ctx, input); bust(); return { id: a.id }; } });
export const updateAccountAction = defineTenantAction({ input: updateAccountSchema, module: M, permission: "finance.account.manage", handler: async ({ ctx, input }) => { await tr.updateAccount(ctx, input); bust(); } });

// Catégories
export const createCategoryAction = defineTenantAction({ input: categorySchema, module: M, permission: "finance.category.manage", handler: async ({ ctx, input }) => { await tr.createCategory(ctx, input); bust(); } });
export const updateCategoryAction = defineTenantAction({ input: updateCategorySchema, module: M, permission: "finance.category.manage", handler: async ({ ctx, input }) => { await tr.updateCategory(ctx, input); bust(); } });

// Mouvements
export const createTransactionAction = defineTenantAction({ input: manualTransactionSchema, module: M, permission: "finance.account.manage", handler: async ({ ctx, input }) => { const t = await tr.createManualTransaction(ctx, input); bust(); return { id: t.id }; } });
export const createTransferAction = defineTenantAction({ input: transferSchema, module: M, permission: "finance.transfer.create", handler: async ({ ctx, input }) => { await tr.createTransfer(ctx, input); bust(); } });
export const cancelTransactionAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.account.manage", handler: async ({ ctx, input }) => { await tr.cancelTransaction(ctx, input.id); bust(); } });
export const reconcileAction = defineTenantAction({ input: reconcileSchema, module: M, permission: "finance.account.manage", handler: async ({ ctx, input }) => { await tr.setReconciled(ctx, input.id, input.reconciled); bust(); } });

// Dépenses
export const createExpenseAction = defineTenantAction({ input: expenseSchema, module: M, permission: "finance.expense.create", handler: async ({ ctx, input }) => { const e = await ex.createExpense(ctx, input); bust(); return { id: e.id }; } });
export const updateExpenseAction = defineTenantAction({ input: updateExpenseSchema, module: M, permission: "finance.expense.update", handler: async ({ ctx, input }) => { await ex.updateExpense(ctx, input); bust(); } });
export const deleteExpenseAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.expense.delete", handler: async ({ ctx, input }) => { await ex.deleteExpense(ctx, input.id); bust(); } });
export const submitExpenseAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.expense.create", handler: async ({ ctx, input }) => { const r = await ex.submitExpense(ctx, input.id); bust(); return r; } });
export const payExpenseAction = defineTenantAction({ input: payExpenseSchema, module: M, permission: ["finance.expense.update", "finance.account.read"], handler: async ({ ctx, input }) => { await ex.payExpense(ctx, input); bust(); } });
export const cancelExpenseAction = defineTenantAction({ input: idSchema, module: M, permission: "finance.expense.update", handler: async ({ ctx, input }) => { await ex.cancelExpense(ctx, input.id); bust(); } });

// Budgets
export const saveBudgetAction = defineTenantAction({ input: budgetSchema, module: M, permission: "finance.budget.manage", handler: async ({ ctx, input }) => { await rp.saveBudget(ctx, input); bust(); } });
