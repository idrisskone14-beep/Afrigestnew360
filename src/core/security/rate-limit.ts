import "server-only";
import { headers } from "next/headers";
import { platformDb } from "@/core/db/client";
import { AppError } from "@/core/errors";

/**
 * Limiteur de débit des formulaires publics (connexion, inscription, mot de passe oublié, démo, contact).
 *  - `checkRateLimitShared` : compteurs en base (table RateLimitBucket), PARTAGÉS entre toutes les instances serverless —
 *    c'est celui qu'utilise `enforceRateLimit`. Fenêtre fixe, incrément atomique (un seul UPSERT).
 *  - `checkRateLimit` : variante en mémoire (fenêtre glissante), utilisée en repli si la base est indisponible et dans les
 *    tests unitaires.
 */
const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000;

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export function checkRateLimit(key: string, { limit, windowMs }: RateLimitOptions, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - recent[0]!)) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimits() {
  hits.clear();
}

export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Lève RATE_LIMITED si l'IP appelante dépasse la limite pour `scope`. */
export async function enforceRateLimit(scope: string, options: RateLimitOptions) {
  const ip = await clientIp();
  const key = `${scope}:${ip}`;
  let res: { ok: boolean; retryAfterSec: number };
  try {
    res = await checkRateLimitShared(key, options);
  } catch (e) {
    console.error("[rate-limit] compteur partagé indisponible, repli en mémoire", e);
    res = checkRateLimit(key, options);
  }
  if (!res.ok) {
    throw new AppError("RATE_LIMITED", `Trop de tentatives. Réessayez dans ${Math.ceil(res.retryAfterSec / 60)} min.`);
  }
}

/** Incrément atomique du compteur partagé ; la fenêtre se réarme d'elle-même une fois écoulée. */
export async function checkRateLimitShared(key: string, { limit, windowMs }: RateLimitOptions): Promise<{ ok: boolean; retryAfterSec: number }> {
  const secs = windowMs / 1000;
  const rows = await platformDb.$queryRaw<{ count: number; retry: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${secs}::float8) THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${secs}::float8) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count", GREATEST(1, ceil(extract(epoch FROM ("RateLimitBucket"."windowStart" + make_interval(secs => ${secs}::float8) - now()))))::int AS retry`;
  const row = rows[0];
  if (!row) throw new Error("Compteur de limitation introuvable.");
  return row.count > limit ? { ok: false, retryAfterSec: row.retry } : { ok: true, retryAfterSec: 0 };
}

/** Supprime les compteurs périmés (appelé par la tâche planifiée). */
export async function purgeRateLimits(): Promise<number> {
  return platformDb.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "windowStart" < now() - interval '1 day'`;
}
