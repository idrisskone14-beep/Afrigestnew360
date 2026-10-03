import { z } from "zod";
import { emailSchema } from "@/core/auth/schemas";
import { COUNTRIES, CURRENCIES } from "@/lib/reference-data";

const uuid = z.string().uuid();

export const platformCreateCompanySchema = z.object({
  legalName: z.string().trim().min(2, "Raison sociale requise").max(150),
  tradeName: z.string().trim().max(150).optional(),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.code === c), "Pays invalide"),
  currency: z.string().refine((c) => CURRENCIES.some((x) => x.code === c), "Devise invalide"),
  planCode: z.string().min(1, "Offre requise"),
  adminEmail: emailSchema,
});

export const platformUpdateCompanySchema = z.object({
  companyId: uuid,
  legalName: z.string().trim().min(2, "Raison sociale requise").max(150),
  tradeName: z.string().trim().max(150).optional(),
  email: z.string().trim().email("E-mail invalide").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.code === c), "Pays invalide"),
  currency: z.string().refine((c) => CURRENCIES.some((x) => x.code === c), "Devise invalide"),
});

export const companyIdSchema = z.object({ companyId: uuid });
export const suspendCompanySchema = z.object({ companyId: uuid, reason: z.string().trim().max(300).optional() });
export const changePlanSchema = z.object({
  companyId: uuid,
  planId: uuid,
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]).optional(),
  billingCycle: z.enum(["MONTHLY", "YEARLY"]).optional(),
});
export const companyModuleSchema = z.object({ companyId: uuid, moduleKey: z.string().min(1), enabled: z.boolean() });
export const resetModuleSchema = z.object({ companyId: uuid, moduleKey: z.string().min(1) });
export const companyLimitSchema = z.object({ companyId: uuid, key: z.string().min(1), value: z.number().int().min(-1).nullable() });

export const updatePlanSchema = z.object({
  planId: uuid,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  priceMonthly: z.number().min(0),
  priceYearly: z.number().min(0),
  trialDays: z.number().int().min(0).max(365),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  moduleKeys: z.array(z.string()),
  limits: z.record(z.string(), z.number().int().min(-1)),
});

export const toggleModuleSchema = z.object({ moduleKey: z.string().min(1), isActive: z.boolean() });

export const DEMO_STATUSES = [
  { value: "NEW", label: "Nouvelle" },
  { value: "CONTACTED", label: "Contactée" },
  { value: "QUALIFIED", label: "Qualifiée" },
  { value: "DEMO_SCHEDULED", label: "Démo planifiée" },
  { value: "WON", label: "Gagnée" },
  { value: "LOST", label: "Perdue" },
] as const;

export const updateDemoRequestSchema = z.object({
  id: uuid,
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "DEMO_SCHEDULED", "WON", "LOST"]),
  notes: z.string().trim().max(2000).optional(),
});
