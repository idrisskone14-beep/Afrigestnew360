import { z } from "zod";
import { COUNTRIES } from "@/lib/reference-data";

/**
 * Parcours de paramétrage du dossier de l'entreprise, rempli par l'administrateur à sa première connexion (puis modifiable
 * à tout moment). Trois sections enregistrées séparément : on peut en passer une et y revenir.
 */
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const rate = z.union([z.literal(""), z.coerce.number().min(0, "Entre 0 et 100").max(100, "Entre 0 et 100")]).optional();

/** 1. Identification */
export const setupIdentificationSchema = z.object({
  legalName: z.string().trim().min(2, "Raison sociale requise").max(150),
  tradeName: text(150),
  acronym: text(40),
  legalForm: text(60),
  shareCapital: z.union([z.literal(""), z.coerce.number().min(0, "Montant positif").max(1e13)]).optional(),
  sector: text(100),
  activityDescription: text(250),
  accountingFramework: text(80),
  rccm: text(60),
  country: z.string().refine((c) => COUNTRIES.some((x) => x.code === c), "Pays invalide"),
  address: text(250),
  commune: text(100),
  city: text(100),
  postalCode: text(20),
  email: z.string().trim().email("E-mail invalide").optional().or(z.literal("")),
  phone: text(40),
});

/** 2. Dossier fiscal */
export const setupFiscalSchema = z.object({
  taxId: text(60),
  taxRegime: text(80),
  activityStartDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide")]).optional(),
  vatFrequency: text(40),
  vatRof: text(60),
  intraCommunityVat: text(60),
  taxRegion: text(120),
  taxOffice: text(120),
  ntd: text(60),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});

/** 3. Dossier social */
export const setupSocialSchema = z.object({
  socialSecurityNumber: text(60),
  familyBenefitRate: rate,
  workAccidentRate: rate,
  minimumWageSector: text(120),
});

export type SetupIdentificationInput = z.input<typeof setupIdentificationSchema>;
export type SetupFiscalInput = z.input<typeof setupFiscalSchema>;
export type SetupSocialInput = z.input<typeof setupSocialSchema>;
/** Valeurs validées (après `parse`) : ce que reçoit le service. */
export type SetupIdentification = z.output<typeof setupIdentificationSchema>;
export type SetupFiscal = z.output<typeof setupFiscalSchema>;
export type SetupSocial = z.output<typeof setupSocialSchema>;
