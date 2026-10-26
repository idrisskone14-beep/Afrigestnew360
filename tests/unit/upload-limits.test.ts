import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (onVercel: string) => {
  vi.stubEnv("NEXT_PUBLIC_ON_VERCEL", onVercel);
  vi.resetModules();
  return import("@/lib/upload-limits");
};

describe("limites d'envoi de fichiers", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("sur Vercel : 4 Mo (la plateforme plafonne le corps d'une requête à 4,5 Mo) pour les documents et les imports", async () => {
    const m = await load("1");
    expect(m.ON_VERCEL).toBe(true);
    expect([m.DOC_MAX_MB, m.IMPORT_MAX_MB]).toEqual([4, 4]);
    expect(m.mb(m.DOC_MAX_MB)).toBeLessThan(4_500_000); // sous le plafond de la plateforme, enveloppe du formulaire comprise
  });

  it("ailleurs : limites d'origine (8 Mo documents, 5 Mo imports)", async () => {
    const m = await load("");
    expect(m.ON_VERCEL).toBe(false);
    expect([m.DOC_MAX_MB, m.IMPORT_MAX_MB]).toEqual([8, 5]);
  });

  it("serveur : les contrôles de taille suivent la même valeur", async () => {
    vi.stubEnv("NEXT_PUBLIC_ON_VERCEL", "1");
    vi.resetModules();
    const { DOC_MAX_BYTES } = await import("@/modules/documents/files");
    const { IMPORT_MAX_BYTES } = await import("@/modules/data/parse");
    expect(DOC_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(IMPORT_MAX_BYTES).toBe(4 * 1024 * 1024);
  });
});
