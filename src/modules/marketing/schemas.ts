import { z } from "zod";
import { emailSchema } from "@/core/auth/schemas";
import { COMPANY_SIZES, COUNTRIES, SECTORS } from "@/lib/reference-data";

const optional = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/** Demande de démonstration / contact. `website` est un champ piège : un humain ne le remplit jamais. */
const baseDemoSchema = z.object({
  fullName: z.string().trim().min(2, "Nom requis").max(100),
  email: emailSchema,
  phone: optional(40),
  companyName: z.string().trim().min(2, "Nom de l'entreprise requis").max(150),
  country: z.string().refine((c) => c === "" || COUNTRIES.some((x) => x.code === c), "Pays invalide").optional(),
  sector: z.string().refine((s) => s === "" || (SECTORS as readonly string[]).includes(s), "Secteur invalide").optional(),
  companySize: z.string().refine((s) => s === "" || (COMPANY_SIZES as readonly string[]).includes(s), "Taille invalide").optional(),
  message: optional(2000),
  source: z.enum(["demo", "contact", "tarifs"]).default("demo"),
  consent: z.literal(true, { error: "Vous devez accepter d'être recontacté(e)" }),
  website: z.string().max(200).optional(),
});

export const demoRequestSchema = baseDemoSchema.refine((v) => v.source !== "contact" || (v.message?.trim().length ?? 0) >= 10, {
  path: ["message"],
  message: "Écrivez-nous quelques lignes (10 caractères minimum)",
});

export type DemoRequestInput = z.input<typeof demoRequestSchema>;
