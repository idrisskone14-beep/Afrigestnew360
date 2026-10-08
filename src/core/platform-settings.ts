import "server-only";
import { platformDb } from "@/core/db/client";

/**
 * Réglages globaux de la plateforme, modifiables depuis le Super Admin sans redéploiement.
 *
 * `signup_mode` :
 *  - "email"    : l'inscrit confirme son adresse par un lien envoyé par e-mail (comportement historique) ;
 *  - "approval" : aucun e-mail n'est nécessaire ; le compte reste « en attente » jusqu'à la validation par le Super Admin.
 * Sans réglage enregistré : variable d'environnement SIGNUP_MODE, puis "email".
 */
export type SignupMode = "email" | "approval";
const KEY = "signup_mode";

const isMode = (v: unknown): v is SignupMode => v === "email" || v === "approval";

export async function getSignupMode(): Promise<SignupMode> {
  const row = await platformDb.platformSetting.findUnique({ where: { key: KEY } });
  if (row && isMode(row.value)) return row.value;
  return isMode(process.env.SIGNUP_MODE) ? process.env.SIGNUP_MODE : "email";
}

export async function setSignupMode(mode: SignupMode, updatedById: string): Promise<void> {
  await platformDb.platformSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: mode, updatedById },
    update: { value: mode, updatedById },
  });
}
