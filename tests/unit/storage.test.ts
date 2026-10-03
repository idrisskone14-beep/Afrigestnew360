import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/core/security/rate-limit";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const COMPANY = "11111111-1111-4111-8111-111111111111";

describe("stockage des logos", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "afg-uploads-"));
  let mod: typeof import("@/core/storage");

  beforeAll(async () => {
    vi.stubEnv("UPLOAD_DIR", dir);
    vi.resetModules();
    mod = await import("@/core/storage");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("détecte le type réel d'après les octets", () => {
    expect(mod.detectImage(PNG)?.mime).toBe("image/png");
    expect(mod.detectImage(JPG)?.mime).toBe("image/jpeg");
    expect(mod.detectImage(WEBP)?.mime).toBe("image/webp");
    expect(mod.detectImage(SVG)).toBeNull();
    expect(mod.detectImage(Buffer.from("MZ exécutable"))).toBeNull();
  });

  it("refuse SVG, fichiers vides et trop gros ; accepte PNG/JPEG/WebP", async () => {
    await expect(mod.saveCompanyLogo(COMPANY, SVG)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(mod.saveCompanyLogo(COMPANY, Buffer.alloc(0))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(mod.saveCompanyLogo(COMPANY, Buffer.concat([PNG, Buffer.alloc(mod.LOGO_MAX_BYTES)]))).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await mod.saveCompanyLogo(COMPANY, PNG)).mime).toBe("image/png");
  });

  it("relit le logo, et un nouveau format remplace l'ancien (un seul logo par entreprise)", async () => {
    await mod.saveCompanyLogo(COMPANY, PNG);
    expect((await mod.readCompanyLogo(COMPANY))?.mime).toBe("image/png");
    await mod.saveCompanyLogo(COMPANY, JPG);
    const logo = await mod.readCompanyLogo(COMPANY);
    expect(logo?.mime).toBe("image/jpeg");
    expect(await mod.storage.get(`${COMPANY}/logo.png`)).toBeNull();
  });

  it("aucun logo → null ; les entreprises sont cloisonnées", async () => {
    expect(await mod.readCompanyLogo("22222222-2222-4222-8222-222222222222")).toBeNull();
  });

  it("refuse toute clé hors du dossier de l'entreprise (traversée de chemin)", async () => {
    for (const key of ["../secret.txt", `${COMPANY}/../../x`, "/etc/passwd", `${COMPANY}/a/b`, "logo.png", `${COMPANY}/..%2f`]) {
      await expect(mod.storage.put(key, Buffer.from("x")), key).rejects.toBeTruthy();
      await expect(mod.storage.get(key), key).rejects.toBeTruthy();
    }
  });
});

describe("limiteur de débit", () => {
  it("autorise jusqu'à la limite puis bloque, et se rouvre après la fenêtre", () => {
    resetRateLimits();
    const opts = { limit: 3, windowMs: 1000 };
    const t = 1_000_000;
    expect([1, 2, 3].map((i) => checkRateLimit("k", opts, t + i).ok)).toEqual([true, true, true]);
    const blocked = checkRateLimit("k", opts, t + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(checkRateLimit("k", opts, t + 1500).ok).toBe(true);
  });

  it("isole les clés entre elles", () => {
    resetRateLimits();
    const opts = { limit: 1, windowMs: 1000 };
    expect(checkRateLimit("a", opts, 1).ok).toBe(true);
    expect(checkRateLimit("a", opts, 2).ok).toBe(false);
    expect(checkRateLimit("b", opts, 2).ok).toBe(true);
  });
});
