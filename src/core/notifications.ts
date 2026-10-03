import "server-only";
import { platformDb, type Db } from "@/core/db/client";
import { appUrl, sendMail } from "@/core/mail";
import type { NotificationType } from "@/core/notification-catalog";

export { NOTIFICATION_CATALOG, NOTIFICATION_TYPE_KEYS, type NotificationType } from "@/core/notification-catalog";

export interface NotifyInput { companyId: string; userIds: string[]; type: NotificationType; title: string; body?: string | null; link?: string | null }

/**
 * Crée les notifications en respectant les préférences de chaque destinataire (une préférence « dans l'application »
 * désactivée est honorée pour TOUT émetteur). Fonctionne dans la transaction de l'émetteur : si elle est annulée,
 * la notification l'est aussi. Le canal e-mail est une file (`emailPending`) distribuée après coup par `flushPendingEmails`.
 */
export async function notify(db: Db, input: NotifyInput): Promise<number> {
  const ids = [...new Set(input.userIds)];
  if (ids.length === 0) return 0;
  const prefs = await db.notificationPreference.findMany({ where: { companyId: input.companyId, type: input.type, userId: { in: ids } }, select: { userId: true, inApp: true, email: true } });
  const pref = new Map(prefs.map((p) => [p.userId, p]));
  const now = new Date();
  const data = ids.flatMap((userId) => {
    const p = pref.get(userId);
    const inApp = p?.inApp ?? true, email = p?.email ?? false;
    if (!inApp && !email) return [];
    // e-mail seul : la ligne sert de file d'attente et ne compte pas parmi les non lues
    return [{ companyId: input.companyId, userId, type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null, emailPending: email, ...(inApp ? {} : { status: "READ" as const, readAt: now }) }];
  });
  if (data.length === 0) return 0;
  await db.notification.createMany({ data });
  return data.length;
}

export const NOTIFICATION_EMAIL_BATCH = 200;

/**
 * Distribue les e-mails en attente (appelée par la tâche planifiée). Sans fournisseur configuré, l'envoi s'affiche en console.
 * Un échec d'envoi laisse la ligne en attente pour la prochaine exécution.
 */
export async function flushPendingEmails(): Promise<{ sent: number; failed: number }> {
  const pending = await platformDb.notification.findMany({ where: { emailPending: true }, orderBy: { createdAt: "asc" }, take: NOTIFICATION_EMAIL_BATCH });
  if (pending.length === 0) return { sent: 0, failed: 0 };
  const users = await platformDb.user.findMany({ where: { id: { in: [...new Set(pending.map((p) => p.userId))] } }, select: { id: true, email: true } });
  const email = new Map(users.map((u) => [u.id, u.email]));
  let sent = 0, failed = 0;
  for (const n of pending) {
    const to = email.get(n.userId);
    try {
      if (to) await sendMail({ to, subject: n.title, text: `${n.title}${n.body ? `\n\n${n.body}` : ""}${n.link ? `\n\nOuvrir : ${appUrl(n.link)}` : ""}\n\n— AfriGest 360 (vous pouvez modifier vos préférences de notification dans Paramètres).` });
      await platformDb.notification.update({ where: { id: n.id }, data: { emailPending: false, emailedAt: to ? new Date() : null } });
      if (to) sent++;
    } catch (e) {
      failed++;
      console.error("[notifications] e-mail non envoyé", n.id, e instanceof Error ? e.message : e);
    }
  }
  return { sent, failed };
}

/** Membres actifs détenant une permission (ou administrateurs), hors utilisateur exclu : audience des notifications. */
export async function usersWithPermission(db: Db, permission: string, excludeUserId?: string): Promise<string[]> {
  const members = await db.companyMembership.findMany({
    where: {
      status: "ACTIVE",
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      OR: [{ role: { isAdmin: true } }, { role: { permissions: { some: { permission: { key: permission } } } } }],
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}
