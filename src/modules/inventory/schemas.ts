import { z } from "zod";

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const money = z.coerce.number().min(0, "Montant positif requis").max(1e13);
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);

export const UNITS = ["unité", "kg", "g", "tonne", "litre", "mètre", "m²", "m³", "carton", "sac", "boîte", "palette", "heure", "jour"] as const;

export const productSchema = z.object({
  sku: z.string().trim().max(40).regex(/^[A-Za-z0-9._-]*$/, "Lettres, chiffres, . - _ uniquement").optional().or(z.literal("")),
  name: z.string().trim().min(2, "Nom requis").max(150),
  description: text(2000),
  type: z.enum(["GOODS", "SERVICE"]),
  categoryId: emptyOr(uuid).optional(),
  unit: z.string().trim().min(1, "Unité requise").max(20),
  barcode: text(60),
  salePrice: money,
  costPrice: money,
  taxId: emptyOr(uuid).optional(),
  trackStock: z.boolean(),
  minStock: z.coerce.number().min(0).max(1e9),
  openingWarehouseId: emptyOr(uuid).optional(),
  openingQuantity: emptyOr(z.coerce.number().min(0).max(1e9)).optional(),
});
export type ProductInput = z.input<typeof productSchema>;
export const updateProductSchema = productSchema.omit({ openingWarehouseId: true, openingQuantity: true }).extend({ id: uuid, isActive: z.boolean().default(true) });

export const categorySchema = z.object({ name: z.string().trim().min(2, "Nom requis").max(60) });
export const updateCategorySchema = categorySchema.extend({ id: uuid });

export const warehouseSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(80),
  code: z.string().trim().min(1, "Code requis").max(12).regex(/^[A-Za-z0-9_-]+$/, "Lettres, chiffres, - ou _"),
  address: text(250),
  isDefault: z.boolean().default(false),
});
export const updateWarehouseSchema = warehouseSchema.extend({ id: uuid, isActive: z.boolean().default(true) });
export const idSchema = z.object({ id: uuid });

export const MOVEMENT_KINDS = [
  { value: "IN", label: "Entrée" },
  { value: "OUT", label: "Sortie" },
  { value: "TRANSFER", label: "Transfert" },
  { value: "ADJUSTMENT", label: "Ajustement" },
  { value: "RETURN", label: "Retour client" },
] as const;

export const movementSchema = z.object({
  kind: z.enum(["IN", "OUT", "TRANSFER", "ADJUSTMENT", "RETURN"]),
  productId: uuid,
  warehouseId: uuid,
  toWarehouseId: emptyOr(uuid).optional(),
  /** Entrée/sortie/transfert/retour : quantité (> 0). Ajustement : quantité réelle comptée (≥ 0). */
  quantity: z.coerce.number().min(0).max(1e9),
  unitCost: emptyOr(money).optional(),
  reason: text(300),
});

export const countSchema = z.object({
  warehouseId: uuid,
  lines: z.array(z.object({ productId: uuid, counted: z.coerce.number().min(0).max(1e9) })).min(1, "Aucune ligne à valider").max(500),
  reason: text(300),
});

export const stockSettingsSchema = z.object({ allowNegativeStock: z.boolean() });
