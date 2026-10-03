import { z } from "zod";
import { COUNTRIES, CURRENCIES } from "@/lib/reference-data";

export const createCompanySchema = z.object({
  legalName: z.string().trim().min(2, "Raison sociale requise").max(150),
  tradeName: z.string().trim().max(150).optional(),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.code === c), "Pays invalide"),
  currency: z.string().refine((c) => CURRENCIES.some((x) => x.code === c), "Devise invalide"),
  sector: z.string().trim().max(100).optional(),
});

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const companySettingsSchema = z.object({
  legalName: z.string().trim().min(2, "Raison sociale requise").max(150),
  tradeName: optionalText(150),
  legalForm: optionalText(60),
  email: z.string().trim().email("E-mail invalide").optional().or(z.literal("")),
  phone: optionalText(40),
  address: optionalText(250),
  city: optionalText(100),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.code === c), "Pays invalide"),
  rccm: optionalText(60),
  taxId: optionalText(60),
  sector: optionalText(100),
  size: optionalText(20),
  currency: z.string().refine((c) => CURRENCIES.some((x) => x.code === c), "Devise invalide"),
  timezone: z.string().min(3).max(60),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});

/** Assistant d'onboarding en 10 étapes (les champs sont regroupés par étape côté interface). */
export const onboardingSchema = z.object({
  // 1. Informations personnelles
  fullName: z.string().trim().min(2, "Nom requis").max(100),
  phone: optionalText(40),
  // 2. Création de l'entreprise
  legalName: z.string().trim().min(2, "Raison sociale requise").max(150),
  tradeName: optionalText(150),
  email: z.string().trim().email("E-mail invalide").optional().or(z.literal("")),
  companyPhone: optionalText(40),
  // 3. Informations légales
  legalForm: optionalText(60),
  rccm: optionalText(60),
  taxId: optionalText(60),
  // 4-5. Secteur et taille
  sector: optionalText(100),
  size: optionalText(20),
  // 6-7. Devise et pays
  currency: z.string().refine((c) => CURRENCIES.some((x) => x.code === c), "Devise invalide"),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.code === c), "Pays invalide"),
  // 9. Adresse
  address: optionalText(250),
  city: optionalText(100),
  // 10. Configuration initiale
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;
