import { z } from "zod";

const text = (max: number) => z.string().trim().max(max, `${max} caractères maximum.`).optional().default("");

export const FNE_TEMPLATE_VALUES = ["B2B", "B2C", "B2G", "B2F"] as const;
export const FNE_PAYMENT_VALUES = ["deferred", "cash", "mobile-money", "transfer", "card", "check"] as const;
export type FneTemplate = (typeof FNE_TEMPLATE_VALUES)[number];
export type FnePaymentMethod = (typeof FNE_PAYMENT_VALUES)[number];

/** Libellés (annexe 1 de la procédure DGI). */
export const FNE_TEMPLATE_LABELS: Record<FneTemplate, string> = {
  B2B: "Entreprise avec NCC (B2B)",
  B2C: "Particulier (B2C)",
  B2G: "Administration publique (B2G)",
  B2F: "Client à l'international (B2F)",
};
export const FNE_PAYMENT_LABELS: Record<FnePaymentMethod, string> = {
  deferred: "À terme (paiement ultérieur)",
  cash: "Espèces",
  "mobile-money": "Mobile money",
  transfer: "Virement bancaire",
  card: "Carte bancaire",
  check: "Chèque",
};

export const fneSettingsSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(["test", "production"]),
  // vide = conserver la clé enregistrée
  apiKey: z.string().trim().max(500, "Clé trop longue.").regex(/^[\x21-\x7e]*$/, "La clé API ne doit contenir ni espace ni accent.").optional().default(""),
  pointOfSale: text(100),
  establishment: text(150),
  commercialMessage: text(300),
  footer: text(300),
  autoCertify: z.boolean(),
  exemptTaxCode: z.enum(["TVAC", "TVAD"]),
});

export const certifyInvoiceSchema = z.object({
  id: z.string().uuid(),
  template: z.enum(FNE_TEMPLATE_VALUES).optional(),
  paymentMethod: z.enum(FNE_PAYMENT_VALUES).optional(),
});
