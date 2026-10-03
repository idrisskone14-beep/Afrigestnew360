import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const dateStr = z.string().min(8, "Date requise");
const optDate = z.string().optional().or(z.literal(""));
const money = z.coerce.number().min(0, "Montant positif").max(1e13);
const qty = z.coerce.number().positive("Quantité > 0").max(1e9);

export const idSchema = z.object({ id: uuid });

export const SITE_STATUSES = [
  { value: "PLANNED", label: "Planifié" }, { value: "ACTIVE", label: "En cours" }, { value: "ON_HOLD", label: "En pause" }, { value: "DONE", label: "Terminé" }, { value: "CANCELLED", label: "Annulé" },
] as const;
export const BUDGET_CATEGORIES = [
  { value: "MATERIALS", label: "Matériaux" }, { value: "LABOUR", label: "Main-d'œuvre" }, { value: "EQUIPMENT", label: "Matériel et engins" }, { value: "SUBCONTRACT", label: "Sous-traitance" }, { value: "OTHER", label: "Autres dépenses" },
] as const;
export const SUBCONTRACT_STATUSES = [
  { value: "PLANNED", label: "Prévu" }, { value: "ACTIVE", label: "En cours" }, { value: "DONE", label: "Terminé" }, { value: "CANCELLED", label: "Annulé" },
] as const;

const E = (list: readonly { value: string }[]) => z.enum(list.map((x) => x.value) as [string, ...string[]]);

export const siteSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(150),
  customerId: emptyOr(uuid).optional(),
  address: text(250),
  city: text(100),
  managerId: emptyOr(uuid).optional(),
  startDate: optDate,
  endDate: optDate,
  description: text(2000),
});
export const updateSiteSchema = siteSchema.extend({ id: uuid, status: E(SITE_STATUSES).default("ACTIVE") });

export const budgetSchema = z.object({
  siteId: uuid,
  lines: z.array(z.object({ category: E(BUDGET_CATEGORIES), amount: money })).max(5),
});

export const memberSchema = z.object({ siteId: uuid, employeeId: uuid, role: text(80), startDate: dateStr });
export const equipmentSchema = z.object({ siteId: uuid, vehicleId: emptyOr(uuid).optional(), name: z.string().trim().min(2, "Désignation requise").max(120), dailyRate: money.default(0), startDate: dateStr });
export const planSchema = z.object({ siteId: uuid, productId: uuid, plannedQty: qty });
export const materialSchema = z.object({
  siteId: uuid, productId: uuid, warehouseId: uuid, type: z.enum(["ISSUE", "RETURN"]), quantity: qty, date: dateStr, note: text(200),
});
export const subcontractSchema = z.object({
  siteId: uuid, supplierId: uuid, scope: z.string().trim().min(3, "Périmètre requis").max(200), contractAmount: money, startDate: optDate, endDate: optDate, notes: text(500),
});
export const updateSubcontractSchema = subcontractSchema.omit({ siteId: true, supplierId: true }).extend({ id: uuid, status: E(SUBCONTRACT_STATUSES).default("ACTIVE") });
export const reportSchema = z.object({
  siteId: uuid, date: dateStr, weather: text(60), workforce: z.coerce.number().int().min(0).max(100000).default(0),
  summary: z.string().trim().min(3, "Résumé requis").max(3000), progress: z.coerce.number().int().min(0, "0 à 100").max(100, "0 à 100"), incidents: text(2000),
});
