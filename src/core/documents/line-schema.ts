import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);

/** Ligne de document commercial (devis, commande, facture, achat…) — le taux de taxe n'est JAMAIS fourni par le client. */
export const lineSchema = z.object({
  productId: emptyOr(uuid).optional(),
  description: z.string().trim().min(1, "Désignation requise").max(500),
  unit: z.string().trim().max(20).default("unité"),
  quantity: z.coerce.number().positive("Quantité > 0").max(1e9),
  unitPrice: z.coerce.number().min(0, "Prix ≥ 0").max(1e13),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  taxId: emptyOr(uuid).optional(),
});
export type LineInput = z.input<typeof lineSchema>;
export type LineOutput = z.output<typeof lineSchema>;
export const linesSchema = z.array(lineSchema).min(1, "Ajoutez au moins une ligne").max(200);
