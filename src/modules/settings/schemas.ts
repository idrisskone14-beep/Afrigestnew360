import { z } from "zod";
import { NOTIFICATION_CATALOG } from "@/core/notification-catalog";
import { emailSchema } from "@/core/auth/schemas";

const uuid = z.string().uuid();

export const inviteMemberSchema = z.object({ email: emailSchema, roleId: uuid });
export const changeRoleSchema = z.object({ membershipId: uuid, roleId: uuid });
export const memberStatusSchema = z.object({ membershipId: uuid, status: z.enum(["ACTIVE", "SUSPENDED"]) });
export const membershipIdSchema = z.object({ membershipId: uuid });
export const invitationIdSchema = z.object({ invitationId: uuid });

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(60),
  description: z.string().trim().max(200).optional(),
  copyFromRoleId: uuid.optional(),
});
export const updateRoleSchema = z.object({
  roleId: uuid,
  name: z.string().trim().min(2, "Nom requis").max(60),
  description: z.string().trim().max(200).optional(),
  permissionKeys: z.array(z.string()).max(500),
});
export const roleIdSchema = z.object({ roleId: uuid });

export const NOTIFICATION_TYPES = NOTIFICATION_CATALOG;

export const notificationPrefsSchema = z.object({
  prefs: z.array(z.object({ type: z.string(), inApp: z.boolean(), email: z.boolean() })).max(50),
});

export const taxSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(60),
  rate: z.coerce.number().min(0, "Taux positif requis").max(100, "100 % maximum"),
  isDefault: z.boolean().default(false),
});
export const updateTaxSchema = taxSchema.extend({ id: uuid, isActive: z.boolean().default(true) });
export const taxIdSchema = z.object({ id: uuid });

export const numberingSchema = z.object({
  key: z.string().min(1),
  prefix: z.string().trim().min(1, "Préfixe requis").max(10).regex(/^[A-Za-z0-9_-]+$/, "Lettres, chiffres, - ou _"),
  padding: z.coerce.number().int().min(1).max(10),
  withYear: z.boolean(),
  resetYearly: z.boolean(),
});
