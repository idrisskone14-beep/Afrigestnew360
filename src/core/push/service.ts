import "server-only";
import { platformDb, platformTransaction } from "@/core/db/client";
import { AppError } from "@/core/errors";

/**
 * Notifications push (Web Push, protocole VAPID). Chaque appareil inscrit a une « adresse » fournie par le service push du navigateur
 * (Google, Mozilla, Apple, Microsoft) ; le serveur y envoie la notification, chiffrée de bout en bout pour cet appareil.
 *
 * Sécurité : le serveur appelle l'adresse enregistrée. Pour qu'un utilisateur ne puisse pas faire contacter une adresse interne
 * (SSRF), seules les adresses HTTPS des services push connus sont acceptées.
 */
const ALLOWED_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => (pushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null);

/** Adresse de service push acceptable : HTTPS, hôte d'un service connu, sans identifiants ni port atypique. */
export function isAllowedEndpoint(raw: string): boolean {
  if (raw.length > 1000) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export interface PushPayload { title: string; body?: string; url?: string; tag?: string }

export interface BrowserSubscription { endpoint: string; keys: { p256dh: string; auth: string } }

async function lib() {
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@ivoireactu.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return webpush;
}

export async function saveSubscription(userId: string, sub: BrowserSubscription, userAgent?: string | null) {
  if (!isAllowedEndpoint(sub.endpoint)) throw new AppError("VALIDATION", "Ce navigateur n'est pas pris en charge pour les notifications push.");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(sub.keys.auth)) throw new AppError("VALIDATION", "Inscription push invalide.");
  const ua = userAgent ? userAgent.slice(0, 300) : null;
  // un même appareil qui change de compte reprend l'inscription : l'adresse est unique
  await platformDb.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua },
  });
}

export async function removeSubscription(userId: string, endpoint: string) {
  await platformDb.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export const countSubscriptions = (userId: string) => platformDb.pushSubscription.count({ where: { userId } });

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** Envoie une notification à des appareils ; retire ceux que le service push dit disparus (404 / 410). */
async function deliver(subs: Sub[], payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (subs.length === 0 || !pushConfigured()) return { sent: 0, removed: 0 };
  const webpush = await lib();
  const body = JSON.stringify({ ...payload, body: payload.body?.slice(0, 200) });
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86_400, urgency: "normal", timeout: 8_000 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.id);
      else console.error("[push] envoi impossible", status ?? "", e instanceof Error ? e.message : e);
    }
  }));
  if (gone.length) await platformDb.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  if (sent) await platformDb.pushSubscription.updateMany({ where: { id: { in: subs.map((s) => s.id) } }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { sent, removed: gone.length };
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const subs = await platformDb.pushSubscription.findMany({ where: { userId }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
  return deliver(subs, payload);
}

export const PUSH_BATCH = 200;

/**
 * Distribue les notifications push en attente (`pushPending`). Les lignes sont réservées d'un coup (UPDATE … RETURNING avec
 * SKIP LOCKED) : deux distributions simultanées ne traitent jamais la même notification. Meilleur effort : une notification
 * qui échoue reste lisible dans l'application.
 */
export async function flushPendingPush(): Promise<{ notifications: number; sent: number; removed: number }> {
  if (!pushConfigured()) return { notifications: 0, sent: 0, removed: 0 };
  const claimed = await platformTransaction(async (tx) =>
    tx.$queryRaw<{ id: string; userId: string; companyId: string; type: string; title: string; body: string | null; link: string | null }[]>`
      UPDATE "Notification" SET "pushPending" = false
      WHERE id IN (SELECT id FROM "Notification" WHERE "pushPending" = true ORDER BY "createdAt" ASC LIMIT ${PUSH_BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id, "userId", "companyId", type, title, body, link`);
  if (claimed.length === 0) return { notifications: 0, sent: 0, removed: 0 };

  const [subs, companies] = await Promise.all([
    platformDb.pushSubscription.findMany({ where: { userId: { in: [...new Set(claimed.map((n) => n.userId))] } }, select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true } }),
    platformDb.company.findMany({ where: { id: { in: [...new Set(claimed.map((n) => n.companyId))] } }, select: { id: true, tradeName: true, legalName: true } }),
  ]);
  const byUser = new Map<string, Sub[]>();
  for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  const name = new Map(companies.map((c) => [c.id, c.tradeName ?? c.legalName]));

  let sent = 0, removed = 0;
  for (const n of claimed) {
    const r = await deliver(byUser.get(n.userId) ?? [], { title: n.title, body: [name.get(n.companyId), n.body].filter(Boolean).join(" · "), url: n.link ?? "/app/notifications", tag: n.type });
    sent += r.sent; removed += r.removed;
  }
  return { notifications: claimed.length, sent, removed };
}
