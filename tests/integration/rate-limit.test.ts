import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRateLimitShared, purgeRateLimits } from "@/core/security/rate-limit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("limiteur de débit partagé (base de données)", () => {
  const admin = new Client({ connectionString: process.env.DIRECT_URL });
  beforeAll(() => admin.connect());
  afterAll(() => admin.end());

  it("autorise jusqu'à la limite puis bloque avec un délai d'attente positif", async () => {
    const o = { limit: 3, windowMs: 60_000 };
    const k = `t-limite-${Date.now()}`;
    const res = [];
    for (let i = 0; i < 5; i++) res.push(await checkRateLimitShared(k, o));
    expect(res.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(res[3]!.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(res[3]!.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("les clés sont indépendantes (une adresse bloquée n'en bloque pas une autre)", async () => {
    const o = { limit: 1, windowMs: 60_000 };
    const a = `t-a-${Date.now()}`;
    expect((await checkRateLimitShared(a, o)).ok).toBe(true);
    expect((await checkRateLimitShared(a, o)).ok).toBe(false);
    expect((await checkRateLimitShared(`t-b-${Date.now()}`, o)).ok).toBe(true);
  });

  it("la fenêtre se réarme d'elle-même une fois écoulée", async () => {
    const o = { limit: 1, windowMs: 1_000 };
    const k = `t-fenetre-${Date.now()}`;
    expect((await checkRateLimitShared(k, o)).ok).toBe(true);
    expect((await checkRateLimitShared(k, o)).ok).toBe(false);
    await sleep(1_300);
    expect((await checkRateLimitShared(k, o)).ok).toBe(true);
  });

  it("atomique sous concurrence : 20 appels simultanés, limite 5, exactement 5 autorisés", async () => {
    const o = { limit: 5, windowMs: 60_000 };
    const k = `t-concurrence-${Date.now()}`;
    const res = await Promise.all(Array.from({ length: 20 }, () => checkRateLimitShared(k, o)));
    expect(res.filter((r) => r.ok)).toHaveLength(5);
  });

  it("purge uniquement les compteurs périmés (plus d'un jour)", async () => {
    const stale = `t-vieux-${Date.now()}`;
    const fresh = `t-recent-${Date.now()}`;
    await admin.query(`INSERT INTO "RateLimitBucket" ("key","count","windowStart") VALUES ($1, 1, now() - interval '2 days'), ($2, 1, now())`, [stale, fresh]);
    const n = await purgeRateLimits();
    expect(n).toBeGreaterThanOrEqual(1);
    const left = await admin.query(`SELECT "key" FROM "RateLimitBucket" WHERE "key" IN ($1, $2)`, [stale, fresh]);
    expect(left.rows.map((r) => r.key)).toEqual([fresh]);
  });
});
