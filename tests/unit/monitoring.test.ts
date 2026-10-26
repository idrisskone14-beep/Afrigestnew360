import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { checkEnv } from "@/core/env";
import { sentryOptions } from "@/core/monitoring/sentry-options";
import { scrubEvent, scrubUrl, sentryOrigin } from "@/core/monitoring/sentry-filter";
import { buildCsp } from "@/core/security/csp";
import { AppError } from "@/core/errors";

const event = (over: Partial<ErrorEvent> = {}): ErrorEvent => ({ type: undefined, exception: { values: [{ type: "TypeError", value: "x is undefined" }] }, ...over }) as ErrorEvent;

describe("suivi d'erreurs : confidentialité", () => {
  it("adresses : requête et fragment retirés, jetons des liens secrets masqués", () => {
    expect(scrubUrl("https://app.exemple.ci/p/AbC123_secret?download=1#x")).toBe("https://app.exemple.ci/p/[token]");
    expect(scrubUrl("/invitation/tok-en")).toBe("/invitation/[token]");
    expect(scrubUrl("/api/p/tok/logo")).toBe("/api/p/[token]/logo");
    expect(scrubUrl("/app/sales/factures/0000?q=dupont")).toBe("/app/sales/factures/0000");
  });

  it("événement : cookies, en-têtes, corps, requête, e-mail, IP et nom de serveur supprimés ; l'identifiant utilisateur est gardé", () => {
    const out = scrubEvent(event({
      request: { url: "https://x.ci/p/secret?a=b", cookies: { s: "1" }, headers: { authorization: "Bearer x", cookie: "c" }, data: { password: "mot-de-passe" }, query_string: "a=b" },
      user: { id: "u1", email: "a@exemple.ci", ip_address: "1.2.3.4", username: "awa" },
      server_name: "machine-privée",
      transaction: "GET /p/jeton-secret",
    }))!;
    expect(out.request).toEqual({ url: "https://x.ci/p/[token]" });
    expect(out.user).toEqual({ id: "u1" });
    expect(out.server_name).toBeUndefined();
    expect(out.transaction).toBe("GET /p/[token]");
    expect(JSON.stringify(out)).not.toMatch(/mot-de-passe|a@exemple|1\.2\.3\.4|Bearer|machine-privée|jeton-secret/);
  });

  it("utilisateur sans identifiant : supprimé ; fil d'Ariane : adresses nettoyées, messages sensibles masqués", () => {
    const out = scrubEvent(event({
      user: { email: "a@exemple.ci" },
      breadcrumbs: [{ category: "navigation", data: { from: "/p/abc?x=1", to: "/app/dashboard" } }, { category: "console", message: "token=abc" }, { category: "console", message: "chargé" }],
    }))!;
    expect(out.user).toBeUndefined();
    expect(out.breadcrumbs![0]!.data).toEqual({ from: "/p/[token]", to: "/app/dashboard" });
    expect(out.breadcrumbs!.map((b) => b.message)).toEqual([undefined, "[masqué]", "chargé"]);
  });

  it("erreurs attendues (AppError) : jamais envoyées ; vraies erreurs : envoyées avec la référence affichée à l'utilisateur", () => {
    const expected = new AppError("VALIDATION", "Champ invalide");
    expect(scrubEvent(event(), { originalException: expected })).toBeNull();
    expect(scrubEvent(event({ exception: { values: [{ type: "AppError", value: "x" }] } }))).toBeNull();
    const bug = Object.assign(new Error("boum"), { digest: "725407040" });
    expect(scrubEvent(event(), { originalException: bug })!.tags).toEqual({ digest: "725407040" });
  });
});

describe("suivi d'erreurs : configuration", () => {
  it("sans DSN : désactivé (rien n'est envoyé) ; avec DSN : actif, sans trace de performance ni données personnelles par défaut", () => {
    expect(sentryOptions(undefined).enabled).toBe(false);
    const o = sentryOptions("https://cle@o1.ingest.sentry.io/1", { environment: "production", release: "abc123" });
    expect(o).toMatchObject({ enabled: true, environment: "production", release: "abc123", sendDefaultPii: false, tracesSampleRate: 0 });
  });

  it("origine du DSN autorisée dans la CSP (connexion sortante) ; absente par défaut", () => {
    expect(sentryOrigin("https://cle@o1.ingest.sentry.io/1")).toBe("https://o1.ingest.sentry.io");
    expect(sentryOrigin("pas un dsn")).toBeNull();
    expect(sentryOrigin(undefined)).toBeNull();
    expect(buildCsp("n", { ingestOrigin: "https://o1.ingest.sentry.io" })).toContain("connect-src 'self' https://o1.ingest.sentry.io");
    expect(buildCsp("n")).toContain("connect-src 'self';");
  });

  const base = { DATABASE_URL: "postgresql://x", AUTH_SECRET: "a".repeat(32), ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.exemple.ci" };
  const sentry = (env: Record<string, string>) => checkEnv({ ...base, ...env }).filter((p) => p.message.includes("SENTRY"));

  it("contrôle de configuration : absent en production et DSN invalide → avertissements (jamais bloquants)", () => {
    expect(sentry({ NODE_ENV: "production" })).toEqual([expect.objectContaining({ level: "warning", message: expect.stringContaining("SENTRY_DSN absente") })]);
    expect(sentry({ SENTRY_DSN: "n'importe quoi" })).toEqual([expect.objectContaining({ level: "warning", message: expect.stringContaining("invalide") })]);
    expect(sentry({ SENTRY_DSN: "https://cle@o1.ingest.sentry.io/1", NODE_ENV: "production" })).toEqual([]);
    expect(sentry({})).toEqual([]); // développement : silence
  });
});
