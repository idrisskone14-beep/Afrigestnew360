import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { checkEnv } from "@/core/env";
import { buildCsp, generateNonce } from "@/core/security/csp";
import { proxy } from "@/proxy";

describe("CSP", () => {
  it("production : scripts uniquement par nonce, aucun unsafe-eval ni unsafe-inline côté scripts", () => {
    const csp = buildCsp("abc123");
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("développement : unsafe-eval (rechargement à chaud) mais pas d'upgrade-insecure-requests", () => {
    const csp = buildCsp("abc", { dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("nonce : 128 bits, base64, différent à chaque appel", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("proxy (première ligne)", () => {
  it("pose une CSP à nonce sur les pages publiques et transmet le nonce à Next", () => {
    const res = proxy(new NextRequest("http://localhost/tarifs"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    // le nonce est aussi propagé dans les en-têtes de requête pour que Next marque ses propres scripts
    const forwarded = res.headers.get("x-middleware-override-headers") ?? "";
    expect(forwarded).toContain("x-nonce");
    expect(forwarded).toContain("content-security-policy");
  });

  it("redirige /app et /super-admin sans cookie de session vers /connexion (CSP incluse)", () => {
    for (const path of ["/app/dashboard", "/super-admin", "/app"]) {
      const res = proxy(new NextRequest(`http://localhost${path}`));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/connexion");
      expect(res.headers.get("content-security-policy")).toBeTruthy();
    }
  });

  it("laisse passer /app avec un cookie de session (la validité est revérifiée côté serveur)", () => {
    const req = new NextRequest("http://localhost/app/dashboard", { headers: { cookie: "authjs.session-token=x" } });
    expect(proxy(req).status).toBe(200);
  });

  it("ne protège pas un chemin qui ressemble à /app sans l'être (/application)", () => {
    expect(proxy(new NextRequest("http://localhost/application")).status).toBe(200);
  });
});

describe("checkEnv", () => {
  const good = {
    DATABASE_URL: "postgresql://u:p@h/db?sslmode=require",
    AUTH_SECRET: "a".repeat(44),
    ENCRYPTION_KEY: "0".repeat(64),
    APP_URL: "https://exemple.com",
    CRON_SECRET: "c".repeat(24),
  };

  it("configuration complète : aucun problème", () => {
    expect(checkEnv({ ...good, NODE_ENV: "production" })).toEqual([]);
  });

  it("signale les variables manquantes par leur nom, sans jamais citer de valeur", () => {
    const problems = checkEnv({ NODE_ENV: "production" });
    const msgs = problems.filter((p) => p.level === "blocking").map((p) => p.message);
    expect(msgs).toEqual(expect.arrayContaining(["DATABASE_URL manquante", "AUTH_SECRET manquante", "ENCRYPTION_KEY manquante", "APP_URL manquante"]));
  });

  it("valide le format de la clé de chiffrement et la longueur du secret de session", () => {
    const msgs = checkEnv({ ...good, ENCRYPTION_KEY: "zz", AUTH_SECRET: "court" }).map((p) => p.message).join(" | ");
    expect(msgs).toContain("ENCRYPTION_KEY invalide");
    expect(msgs).toContain("AUTH_SECRET trop courte");
    expect(msgs).not.toContain("zz");
  });

  it("avertit sans bloquer : e-mails non configurés, tâche planifiée absente, http, base sans SSL", () => {
    const problems = checkEnv({ ...good, NODE_ENV: "production", REQUIRE_EMAIL_VERIFICATION: "true", CRON_SECRET: undefined, APP_URL: "http://exemple.com", DATABASE_URL: "postgresql://u:p@h/db" });
    expect(problems.every((p) => p.level === "warning")).toBe(true);
    const msgs = problems.map((p) => p.message).join(" | ");
    expect(msgs).toContain("RESEND_API_KEY");
    expect(msgs).toContain("CRON_SECRET");
    expect(msgs).toContain("https://");
    expect(msgs).toContain("sslmode");
  });
});
