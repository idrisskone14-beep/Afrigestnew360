import { z } from "zod";
import { validateBrackets } from "./calc";

const uuid = z.string().uuid();
const dateStr = z.string().min(8, "Date requise");
const optDate = z.string().optional().or(z.literal(""));
const money = z.coerce.number().min(0, "Montant positif").max(1e13);

export const idSchema = z.object({ id: uuid });
export const ITEM_TYPES = [{ value: "EARNING", label: "Gain" }, { value: "DEDUCTION", label: "Retenue salariale" }, { value: "EMPLOYER", label: "Charge patronale" }] as const;
export const CATEGORIES = [{ value: "SOCIAL", label: "Cotisation sociale" }, { value: "TAX", label: "Impôt" }, { value: "OTHER", label: "Autre" }] as const;
export const MODES = [{ value: "FIXED", label: "Montant fixe" }, { value: "RATE", label: "Pourcentage" }, { value: "BRACKETS", label: "Barème par tranches" }] as const;
export const BASES = [{ value: "BASE", label: "Salaire de base" }, { value: "GROSS", label: "Salaire brut" }, { value: "TAXABLE", label: "Assiette imposable" }] as const;

export const bracketSchema = z.object({ upTo: z.coerce.number().positive().max(1e13).nullable(), rate: z.coerce.number().min(0).max(100) });

export const payrollItemSchema = z.object({
  code: z.string().trim().min(2, "Code requis").max(20).regex(/^[A-Z0-9_-]+$/i, "Lettres, chiffres, tiret ou souligné"),
  name: z.string().trim().min(2, "Libellé requis").max(120),
  type: z.enum(["EARNING", "DEDUCTION", "EMPLOYER"]),
  category: z.enum(["SOCIAL", "TAX", "OTHER"]).default("OTHER"),
  mode: z.enum(["FIXED", "RATE", "BRACKETS"]),
  base: z.enum(["BASE", "GROSS", "TAXABLE"]).default("GROSS"),
  value: z.coerce.number().min(0).max(1e13).default(0),
  ceiling: z.union([z.literal(""), z.coerce.number().positive().max(1e13)]).optional(),
  brackets: z.array(bracketSchema).max(20).optional(),
  taxable: z.boolean().default(true),
  deductibleForTax: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(100),
  effectiveFrom: dateStr,
}).superRefine((v, ctx) => {
  if (v.mode === "RATE" && v.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "Un pourcentage ne dépasse pas 100." });
  if (v.mode === "BRACKETS") {
    if (v.type === "EARNING") ctx.addIssue({ code: "custom", path: ["mode"], message: "Un gain ne peut pas être calculé par tranches." });
    const err = validateBrackets(v.brackets ?? []);
    if (err) ctx.addIssue({ code: "custom", path: ["brackets"], message: err });
  }
  if (v.type === "EARNING" && v.mode === "RATE" && v.base !== "BASE") ctx.addIssue({ code: "custom", path: ["base"], message: "Un gain en pourcentage s'applique au salaire de base." });
  if (v.type === "EARNING" && v.category !== "OTHER") ctx.addIssue({ code: "custom", path: ["category"], message: "Un gain n'a pas de catégorie." });
  if (v.type === "EMPLOYER" && v.category === "TAX") ctx.addIssue({ code: "custom", path: ["category"], message: "Une charge patronale est une cotisation sociale ou autre." });
});
export type PayrollItemInput = z.input<typeof payrollItemSchema>;
export const toggleItemSchema = z.object({ id: uuid, isActive: z.boolean() });

export const employeeItemSchema = z.object({
  employeeId: uuid,
  name: z.string().trim().min(2, "Libellé requis").max(120),
  type: z.enum(["EARNING", "DEDUCTION"]),
  category: z.enum(["SOCIAL", "TAX", "OTHER"]).default("OTHER"),
  amount: money.refine((v) => v > 0, "Montant > 0"),
  taxable: z.boolean().default(true),
  startDate: dateStr,
  endDate: optDate,
});

export const runSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12), notes: z.string().trim().max(300).optional().or(z.literal("")) });
export const payRunSchema = z.object({ id: uuid, accountId: z.union([z.literal(""), uuid]).optional(), date: dateStr });
