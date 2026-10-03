import { z } from "zod";
import { passwordSchema } from "./password-policy";

export const emailSchema = z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Mot de passe requis"),
  totp: z.string().trim().optional(),
  next: z.string().optional(),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Nom requis").max(100),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: "Vous devez accepter les conditions d'utilisation" }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Les mots de passe ne correspondent pas" });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ token: z.string().min(10), password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Les mots de passe ne correspondent pas" });

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Requis"), password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Les mots de passe ne correspondent pas" });

export const acceptInvitationSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(2).max(100).optional(),
  password: passwordSchema.optional(),
});

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Code à 6 chiffres") });
export const disableTotpSchema = z.object({ password: z.string().min(1, "Requis"), code: z.string().trim().min(6, "Code requis") });
