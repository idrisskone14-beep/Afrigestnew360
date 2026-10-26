import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkEnv } from "@/core/env";
import { LEGAL_PAGES, TO_COMPLETE, legalInfo, missingLegal } from "@/lib/legal";

const FULL = {
  LEGAL_COMPANY: "KAKO SARL", LEGAL_FORM: "SARL au capital de 1 000 000 FCFA", LEGAL_ADDRESS: "Cocody, Abidjan", LEGAL_REGISTRATION: "CI-ABJ-2026-B-1", LEGAL_PUBLISHER: "A. Koné",
  LEGAL_EMAIL: "legal@exemple.ci", LEGAL_PHONE: "+225 01 02 03 04", LEGAL_HOST: "Vercel Inc.", LEGAL_COUNTRY: "Côte d'Ivoire", LEGAL_AUTHORITY: "l'ARTCI",
};

describe("informations légales de l'éditeur", () => {
  it("valeurs absentes → « [à compléter] » ; téléphone facultatif ; espaces ignorés", () => {
    const empty = legalInfo({});
    expect(Object.values(empty).every((v) => v === TO_COMPLETE)).toBe(true);
    expect(missingLegal({})).not.toContain("LEGAL_PHONE");
    expect(missingLegal({})).toHaveLength(9);
    expect(missingLegal({ ...FULL })).toEqual([]);
    expect(legalInfo({ ...FULL, LEGAL_EMAIL: "   " }).email).toBe(TO_COMPLETE);
    expect(legalInfo(FULL).company).toBe("KAKO SARL");
  });

  it("le contrôle de configuration avertit (sans jamais bloquer) tant que les pages légales sont incomplètes", () => {
    const base = { DATABASE_URL: "postgresql://x", AUTH_SECRET: "a".repeat(32), ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.exemple.ci" };
    const incomplete = checkEnv(base).find((p) => p.message.startsWith("Pages légales incomplètes"));
    expect(incomplete).toMatchObject({ level: "warning" });
    expect(incomplete!.message).toContain("LEGAL_COMPANY");
    expect(checkEnv({ ...base, ...FULL }).some((p) => p.message.includes("Pages légales"))).toBe(false);
  });
});

describe("pages légales", () => {
  const render = async (path: string, env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    try {
      const mod = await import(path);
      return renderToStaticMarkup(createElement(mod.default));
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  };
  const PAGES = ["conditions-utilisation", "confidentialite", "mentions-legales"];

  it("chaque page affiche les informations de l'éditeur renseignées et un renvoi vers les deux autres", async () => {
    for (const p of PAGES) {
      const html = await render(`@/app/(marketing)/${p}/page`, FULL);
      expect(html, p).toContain("KAKO SARL");
      expect(html, p).not.toContain(TO_COMPLETE);
      for (const l of LEGAL_PAGES) expect(html, `${p} → ${l.href}`).toContain(`href="${l.href}"`);
    }
  });

  it("sans configuration, les champs manquants sont visibles (surlignés), jamais vides", async () => {
    const html = await render("@/app/(marketing)/mentions-legales/page", {});
    expect(html).toContain("<mark");
    expect(html).toContain(TO_COMPLETE);
  });

  it("la politique de confidentialité décrit les cookies réellement déposés et l'absence de traceurs publicitaires", async () => {
    const html = await render("@/app/(marketing)/confidentialite/page", FULL);
    for (const c of ["authjs.session-token", "afg_company", "afg_year"]) expect(html).toContain(c);
    expect(html).toContain("aucun cookie publicitaire");
  });

  it("les conditions rappellent que paie et comptabilité doivent être validées par un professionnel", async () => {
    const html = await render("@/app/(marketing)/conditions-utilisation/page", FULL);
    expect(html).toContain("liasse officielle");
    expect(html).toContain("barème légal de paie");
  });
});
