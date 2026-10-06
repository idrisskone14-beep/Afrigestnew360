import "server-only";
import { cache } from "react";
import { platformDb } from "@/core/db/client";
import { auth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
  locale: string;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
}

export interface CurrentSession {
  sessionId: string;
  user: SessionUser;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Identité portée par le JWT (aucun accès base) : sert à lancer les lectures en parallèle avant de valider la session. */
export async function readJwtSession(): Promise<{ userId: string; sid: string } | null> {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = session?.sid;
  return userId && sid ? { userId, sid } : null;
}

/** Ligne UserSession (avec son utilisateur) telle que lue en base. */
export interface SessionRowLike {
  id: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  lastSeenAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    isPlatformAdmin: boolean;
    locale: string;
    status: string;
    deletedAt: Date | null;
    totpEnabledAt: Date | null;
    emailVerifiedAt: Date | null;
  };
}

/**
 * Valide une ligne de session lue en base : un JWT valide mais dont la UserSession est révoquée, expirée ou dont
 * l'utilisateur est désactivé est refusé (révocation immédiate). Met à jour « dernière activité » au plus toutes les 5 min.
 */
export async function acceptSessionRow(row: SessionRowLike | null, userId: string, sid: string): Promise<CurrentSession | null> {
  if (!row || row.userId !== userId) return null;
  if (row.revokedAt || row.expiresAt <= new Date()) return null;
  if (row.user.status !== "ACTIVE" || row.user.deletedAt) return null;

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await platformDb.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date() } });
  }

  return {
    sessionId: row.id,
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      isPlatformAdmin: row.user.isPlatformAdmin,
      locale: row.user.locale,
      twoFactorEnabled: row.user.totpEnabledAt !== null,
      emailVerified: row.user.emailVerifiedAt !== null,
    },
  };
}

/** Session courante, validée EN BASE (voir `acceptSessionRow`). */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const jwt = await readJwtSession();
  if (!jwt) return null;
  const row = await platformDb.userSession.findUnique({ where: { id: jwt.sid }, include: { user: true } });
  return acceptSessionRow(row, jwt.userId, jwt.sid);
});
