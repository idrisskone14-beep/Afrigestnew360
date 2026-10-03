import "server-only";
import { headers } from "next/headers";
import { AppError } from "@/core/errors";

/**
 * Limiteur à fenêtre glissante, en mémoire (par instance). Protège les formulaires publics
 * (inscription, mot de passe oublié, démo, contact) contre l'abus simple. Pour un déploiement
 * multi-instances, remplacer le store par Redis sans changer l'API.
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
  const res = checkRateLimit(`${scope}:${ip}`, options);
  if (!res.ok) {
    throw new AppError("RATE_LIMITED", `Trop de tentatives. Réessayez dans ${Math.ceil(res.retryAfterSec / 60)} min.`);
  }
}
