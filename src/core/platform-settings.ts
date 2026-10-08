import "server-only";
import { platformDb } from "@/core/db/client";

/**
 * Réglages globaux de la plateforme, modifiables depuis le Super Admin sans redéploiement.
 *
 * `signup_mode` :
 *  - "email"    : l'inscrit confirme son adresse par un lien envoyé par e-mail (comportement historique) ;
 *  - "approval" : aucun e-mail n'est nécessaire ; le compte reste « en attente » jusqu'à la validation par le Super Admin.
 * Sans réglage enregistré : variable d'environnement SIGNUP_MODE, puis "email".
 *
 * Règle de sécurité de fonctionnement : une inscription ne doit JAMAIS aboutir à un compte inutilisable. Si l'envoi d'e-mails
 * n'est pas opérationnel (production sans clé Resend), le mode EFFECTIF passe automatiquement en "approval" ; et si un envoi
 * échoue en cours d'inscription, le compte bascule en attente de validation (voir `registerUser`).
 */
export type SignupMode = "email" | "approval";
const KEY = "signup_mode";

const isMode = (v: unknown): v is SignupMode => v === "email" || v === "approval";

/** Les e-mails peuvent-ils partir ? En développement ils s'affichent dans la console ; en production il faut une clé Resend. */
export const emailDeliveryAvailable = () => process.env.NODE_ENV !== "production" || Boolean(process.env.RESEND_API_KEY);

/** Mode choisi par le Super Admin (ou, à défaut, par l'environnement). */
export async function getConfiguredSignupMode(): Promise<SignupMode> {
  const row = await platformDb.platformSetting.findUnique({ where: { key: KEY } });
  if (row && isMode(row.value)) return row.value;
  return isMode(process.env.SIGNUP_MODE) ? process.env.SIGNUP_MODE : "email";
}

/** Mode réellement appliqué : le mode choisi, sauf si la confirmation par e-mail est impossible. */
export async function getSignupMode(): Promise<SignupMode> {
  const configured = await getConfiguredSignupMode();
  return configured === "email" && !emailDeliveryAvailable() ? "approval" : configured;
}

export async function setSignupMode(mode: SignupMode, updatedById: string): Promise<void> {
  await platformDb.platformSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: mode, updatedById },
    update: { value: mode, updatedById },
  });
}
