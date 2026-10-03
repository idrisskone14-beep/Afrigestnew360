import { z } from "zod";
import { APPROVAL_TYPE_KEYS } from "@/core/approval-types";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);

export const MAX_STEPS = 5;

export const stepSchema = z.object({ label: z.string().trim().min(2, "Libellé de l'étape requis").max(60), roleId: uuid });

export const ruleSchema = z.object({
  resourceType: z.enum(APPROVAL_TYPE_KEYS as [string, ...string[]]),
  name: z.string().trim().min(2, "Nom requis").max(80),
  /** Montant (ou nombre de jours pour les congés) à partir duquel la règle s'applique, inclus. */
  minAmount: z.coerce.number().min(0, "Montant positif").max(1e13).default(0),
  /** Limite haute, exclue ; vide = sans limite. */
  maxAmount: emptyOr(z.coerce.number().positive("Doit dépasser le minimum").max(1e13)).optional(),
  departmentId: emptyOr(uuid).optional(),
  requesterRoleId: emptyOr(uuid).optional(),
  priority: z.coerce.number().int().min(0).max(1000).default(100),
  isActive: z.boolean().default(true),
  steps: z.array(stepSchema).min(1, "Au moins une étape").max(MAX_STEPS, `${MAX_STEPS} étapes maximum`),
});
export const updateRuleSchema = ruleSchema.extend({ id: uuid });
export const idSchema = z.object({ id: uuid });
export const toggleRuleSchema = z.object({ id: uuid, isActive: z.boolean() });
