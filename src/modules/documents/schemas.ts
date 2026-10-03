import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const idSchema = z.object({ id: uuid });

/** Types d'entités auxquelles un document peut être rattaché. */
export const ENTITY_TYPES = ["customer", "supplier", "employee", "project", "expense", "invoice", "supplier_bill", "purchase_order", "vehicle", "driver", "fine", "site", "site_report"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const entityTypeSchema = z.enum(ENTITY_TYPES);

export const folderSchema = z.object({ name: z.string().trim().min(1, "Nom requis").max(80), parentId: emptyOr(uuid).optional() });
export const renameFolderSchema = z.object({ id: uuid, name: z.string().trim().min(1, "Nom requis").max(80) });

export const documentMetaSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(150),
  description: text(1000),
  folderId: emptyOr(uuid).optional(),
  visibility: z.enum(["COMPANY", "RESTRICTED"]).default("COMPANY"),
  tags: text(200),
  /** Échéance (YYYY-MM-DD) : contrat, assurance, certificat… alerte 30 jours avant. */
  expiresAt: z.string().optional().or(z.literal("")),
});
export const updateDocumentSchema = documentMetaSchema.extend({ id: uuid });

export const linkSchema = z.object({ id: uuid, entityType: entityTypeSchema, entityId: uuid });
export const shareSchema = z.object({ id: uuid, userId: uuid, canEdit: z.boolean().default(false) });
export const unshareSchema = z.object({ id: uuid, userId: uuid });

/** Étiquettes : « a, b, c » → liste nettoyée (max 10, 30 caractères chacune). */
export const parseTags = (raw?: string | null) => [...new Set((raw ?? "").split(",").map((t) => t.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 10);
