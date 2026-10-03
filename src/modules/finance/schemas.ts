import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const dateStr = z.string().min(8, "Date requise");
const amount = z.coerce.number().positive("Montant > 0").max(1e13);

export const ACCOUNT_TYPES = [
  { value: "BANK", label: "Compte bancaire" }, { value: "CASH", label: "Caisse" }, { value: "MOBILE_MONEY", label: "Mobile money" },
] as const;
export const METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "MOBILE_MONEY", "CARD", "OTHER"] as const;

export const accountSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(100),
  type: z.enum(["BANK", "CASH", "MOBILE_MONEY"]),
  bankName: text(100),
  accountNumber: text(60),
  openingBalance: z.coerce.number().min(-1e13).max(1e13).default(0),
  isDefault: z.boolean().default(false),
});
export type AccountInput = z.input<typeof accountSchema>;
export const updateAccountSchema = accountSchema.extend({ id: uuid, isActive: z.boolean().default(true) });
export const idSchema = z.object({ id: uuid });

export const categorySchema = z.object({ name: z.string().trim().min(2, "Nom requis").max(80), kind: z.enum(["INCOME", "EXPENSE"]) });
export const updateCategorySchema = z.object({ id: uuid, name: z.string().trim().min(2).max(80), isActive: z.boolean() });

export const manualTransactionSchema = z.object({
  accountId: uuid,
  type: z.enum(["IN", "OUT"]),
  date: dateStr,
  amount,
  categoryId: emptyOr(uuid).optional(),
  description: z.string().trim().min(2, "Libellé requis").max(250),
  reference: text(100),
});

export const transferSchema = z.object({
  fromAccountId: uuid,
  toAccountId: uuid,
  amount,
  date: dateStr,
  description: text(250),
});

export const expenseSchema = z.object({
  date: dateStr,
  categoryId: uuid,
  supplierId: emptyOr(uuid).optional(),
  description: z.string().trim().min(2, "Libellé requis").max(250),
  amount,
  method: z.enum(METHODS).default("CASH"),
  accountId: emptyOr(uuid).optional(),
  reference: text(100),
  notes: text(1000),
  branchId: emptyOr(uuid).optional(),
  costCenterId: emptyOr(uuid).optional(),
  projectId: emptyOr(uuid).optional(),
});
export type ExpenseInput = z.input<typeof expenseSchema>;
export const updateExpenseSchema = expenseSchema.extend({ id: uuid });
export const payExpenseSchema = z.object({ id: uuid, accountId: uuid, date: dateStr, method: z.enum(METHODS), reference: text(100) });

export const budgetSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  categoryId: uuid,
  months: z.array(z.coerce.number().min(0).max(1e13)).length(12),
});
export const reconcileSchema = z.object({ id: uuid, reconciled: z.boolean() });
