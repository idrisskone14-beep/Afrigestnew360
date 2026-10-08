import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { platformDb } from "@/core/db/client";
import { conflict, notFound } from "@/core/errors";
import { appUrl, sendMail } from "@/core/mail";

/**
 * Deux sortes de comptes attendent le Super Admin :
 *  - « pending »    : inscription en attente de validation (mode « approval », ou repli quand l'e-mail n'a pas pu partir) ;
 *  - « unverified » : compte actif dont l'adresse n'a jamais été confirmée et qui ne s'est jamais connecté — typiquement une
 *    inscription restée bloquée parce que l'e-mail de confirmation n'est jamais arrivé. Le Super Admin peut le débloquer.
 */
export type RegistrationKind = "pending" | "unverified";

export interface PendingRegistration {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  kind: RegistrationKind;
}

const PENDING: Prisma.UserWhereInput = { status: "PENDING", deletedAt: null };
const UNVERIFIED: Prisma.UserWhereInput = { status: "ACTIVE", emailVerifiedAt: null, lastLoginAt: null, isPlatformAdmin: false, deletedAt: null };
const WAITING: Prisma.UserWhereInput = { OR: [PENDING, UNVERIFIED] };

/** Comptes à traiter, les plus anciens d'abord. */
export async function listPendingRegistrations(): Promise<PendingRegistration[]> {
  const rows = await platformDb.user.findMany({
    where: WAITING,
    select: { id: true, name: true, email: true, createdAt: true, status: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return rows.map(({ status, ...r }) => ({ ...r, kind: status === "PENDING" ? ("pending" as const) : ("unverified" as const) }));
}

export const countPendingRegistrations = () => platformDb.user.count({ where: WAITING });

/** Un échec d'envoi ne doit jamais annuler la décision du Super Admin : l'état du compte est la source de vérité. */
async function tryMail(to: string, subject: string, text: string) {
  try {
    await sendMail({ to, subject, text });
  } catch (e) {
    console.error("[inscriptions] e-mail non envoyé", e);
  }
}

/**
 * Valide un compte : il devient actif et son adresse e-mail est tenue pour vérifiée (le Super Admin s'en porte garant).
 * Atomique : deux validations simultanées ne passent pas (conditionné sur l'état « à traiter »).
 */
export async function approveRegistration(userId: string) {
  const user = await platformDb.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw notFound("Inscription");
  const { count } = await platformDb.user.updateMany({
    where: { id: userId, ...WAITING },
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

/** Refuse un compte : il est désactivé (il ne peut ni se connecter ni se réinscrire avec la même adresse). */
export async function rejectRegistration(userId: string) {
  const user = await platformDb.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw notFound("Inscription");
  const { count } = await platformDb.user.updateMany({
    where: { id: userId, ...WAITING },
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
