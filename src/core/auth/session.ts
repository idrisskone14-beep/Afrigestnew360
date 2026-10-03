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

/**
 * Session courante, validée EN BASE : un JWT valide mais dont la UserSession est révoquée,
 * expirée ou dont l'utilisateur est désactivé est refusé (révocation immédiate).
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = session?.sid;
  if (!userId || !sid) return null;

  const row = await platformDb.userSession.findUnique({
    where: { id: sid },
    include: { user: true },
  });
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
});
