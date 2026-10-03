import { z } from "zod";
import { MAPPING_KEYS } from "./chart";

const uuid = z.string().uuid();
const dateStr = z.string().min(8, "Date requise");
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const money = z.coerce.number().min(0).max(1e13);

export const idSchema = z.object({ id: uuid });

export const ledgerAccountSchema = z.object({
  code: z.string().trim().regex(/^[1-8]\d{2,7}$/, "Code de 3 à 8 chiffres, commençant par la classe (1 à 8)"),
  name: z.string().trim().min(2, "Libellé requis").max(120),
});
export const updateLedgerAccountSchema = z.object({ id: uuid, name: z.string().trim().min(2).max(120), isActive: z.boolean() });

export const mappingSchema = z.object({ key: z.enum(Object.keys(MAPPING_KEYS) as [string, ...string[]]), ledgerAccountId: uuid });

export const entryLineSchema = z.object({
  ledgerAccountId: uuid,
  label: z.string().trim().min(1, "Libellé requis").max(200),
  debit: money.default(0),
  credit: money.default(0),
});
export const manualEntrySchema = z.object({
  journalId: uuid,
  date: dateStr,
  reference: text(60),
  description: z.string().trim().min(2, "Libellé requis").max(250),
  lines: z.array(entryLineSchema).min(2, "Au moins deux lignes").max(100),
});
export type ManualEntryInput = z.input<typeof manualEntrySchema>;
export const updateManualEntrySchema = manualEntrySchema.extend({ id: uuid });

export const fiscalYearSchema = z.object({ name: z.string().trim().min(2, "Nom requis").max(40), startDate: dateStr, endDate: dateStr });
export const periodLockSchema = z.object({ id: uuid, locked: z.boolean() });
