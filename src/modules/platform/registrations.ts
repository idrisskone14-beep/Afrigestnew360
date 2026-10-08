import "server-only";
import { platformDb } from "@/core/db/client";
import { conflict, notFound } from "@/core/errors";
import { appUrl, sendMail } from "@/core/mail";

export interface PendingRegistration {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

/** Inscriptions en attente de validation (mode « approval »), les plus anciennes d'abord. */
export async function listPendingRegistrations(): Promise<PendingRegistration[]> {
  return platformDb.user.findMany({
    where: { status: "PENDING", deletedAt: null },
    select: { id: true, name: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
}

export const countPendingRegistrations = () => platformDb.user.count({ where: { status: "PENDING", deletedAt: null } });

/** Un échec d'envoi ne doit jamais annuler la décision du Super Admin : l'état du compte est la source de vérité. */
async function tryMail(to: string, subject: string, text: string) {
  try {
    await sendMail({ to, subject, text });
  } catch (e) {
    console.error("[inscriptions] e-mail non envoyé", e);
  }
}

/**
 * Valide une inscription : le compte devient actif et l'adresse e-mail est tenue pour vérifiée (le Super Admin s'en porte
 * garant). Atomique : deux validations simultanées ne passent pas (conditionné sur l'état « en attente »).
 */
export async function approveRegistration(userId: string) {
  const user = await platformDb.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw notFound("Inscription");
  const { count } = await platformDb.user.updateMany({
    where: { id: userId, status: "PENDING", deletedAt: null },
    data: { status: "ACTIVE", emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  if (count === 0) throw conflict("Cette inscription a déjà été traitée.");
  await tryMail(
    user.email,
    "Votre compte AfriGest 360 est validé",
    `Bonjour ${user.name},\n\nVotre inscription a été validée. Vous pouvez dès maintenant vous connecter et créer votre entreprise :\n${appUrl("/connexion")}\n\nL'équipe AfriGest 360`,
  );
  return user;
}

/** Refuse une inscription : le compte est désactivé (il ne peut ni se connecter ni se réinscrire avec la même adresse). */
export async function rejectRegistration(userId: string) {
  const user = await platformDb.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw notFound("Inscription");
  const { count } = await platformDb.user.updateMany({
    where: { id: userId, status: "PENDING", deletedAt: null },
    data: { status: "DISABLED" },
  });
  if (count === 0) throw conflict("Cette inscription a déjà été traitée.");
  await tryMail(
    user.email,
    "Votre inscription à AfriGest 360",
    `Bonjour ${user.name},\n\nVotre demande d'inscription n'a pas été retenue. Pour toute question, répondez à ce message ou contactez-nous.\n\nL'équipe AfriGest 360`,
  );
  return user;
}
