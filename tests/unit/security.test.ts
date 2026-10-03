import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateToken, hashToken } from "@/core/auth/crypto";
import { hashPassword, passwordSchema, verifyPassword } from "@/core/auth/password";
import { base32Decode, base32Encode, generateRecoveryCodes, hotp, totp, verifyTotp } from "@/core/auth/totp";
import { scopeArgs } from "@/core/db/scope";
import { TENANT_KEY } from "@/core/db/tenant-models";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("TOTP (RFC 6238 / RFC 4226)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("base32 aller-retour", () => {
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("vecteurs de test RFC 4226", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676"];
    expected.forEach((code, i) => expect(hotp(secret, i)).toBe(code));
  });
  it("vecteur RFC 6238 (t=59s → 287082 sur 6 chiffres)", () => {
    expect(totp(secret, 59_000)).toBe("287082");
  });
  it("tolère ±1 pas mais pas davantage", () => {
    const now = 1_700_000_000_000;
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(true);
    expect(verifyTotp(secret, code, now + 120_000)).toBe(false);
    expect(verifyTotp(secret, "abc123", now)).toBe(false);
  });
  it("génère des codes de secours uniques", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  });
});

describe("chiffrement & jetons", () => {
  it("AES-GCM aller-retour et inviolable", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
    const tampered = enc.slice(0, -2) + (enc.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(tampered)).toThrow();
  });
  it("les jetons sont aléatoires et seul le hash est comparable", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(hashToken(a.token)).toBe(a.hash);
  });
});

describe("mots de passe", () => {
  it("hash/verify", async () => {
    const h = await hashPassword("Abcdefghi1");
    expect(await verifyPassword("Abcdefghi1", h)).toBe(true);
    expect(await verifyPassword("autre", h)).toBe(false);
  });
  it("politique", () => {
    expect(passwordSchema.safeParse("court1A").success).toBe(false);
    expect(passwordSchema.safeParse("sansmajuscule123").success).toBe(false);
    expect(passwordSchema.safeParse("SansChiffreAucun").success).toBe(false);
    expect(passwordSchema.safeParse("Valide12345").success).toBe(true);
  });
});

describe("scopeArgs (isolation applicative)", () => {
  it("laisse lisibles les catalogues globaux mais en interdit l'écriture", () => {
    const args = { where: { key: "finance" } };
    expect(scopeArgs("Module", "findMany", args, COMPANY)).toBe(args);
    expect(scopeArgs("Permission", "findFirst", args, COMPANY)).toBe(args);
    for (const model of ["Module", "Plan", "PlanModule", "PlanLimit", "Permission"]) {
      expect(() => scopeArgs(model, "update", { where: { id: "x" }, data: {} }, COMPANY)).toThrow();
      expect(() => scopeArgs(model, "create", { data: {} }, COMPANY)).toThrow();
      expect(() => scopeArgs(model, "deleteMany", {}, COMPANY)).toThrow();
    }
  });
  it("interdit tout accès aux tables d'identité/plateforme depuis un contexte entreprise", () => {
    for (const model of ["User", "UserSession", "AuthToken", "DemoRequest"]) {
      expect(() => scopeArgs(model, "findMany", {}, COMPANY), model).toThrow();
    }
  });
  it("filtre les lectures multiples", () => {
    expect(scopeArgs("Branch", "findMany", { where: { name: "x" } }, COMPANY)).toEqual({
      where: { AND: [{ name: "x" }, { companyId: COMPANY }] },
    });
    expect(scopeArgs("Branch", "findMany", undefined, COMPANY)).toEqual({
      where: { AND: [{}, { companyId: COMPANY }] },
    });
  });
  it("fusionne l'entreprise dans les clauses uniques", () => {
    expect(scopeArgs("Branch", "update", { where: { id: "b1" }, data: {} }, COMPANY)).toMatchObject({
      where: { id: "b1", companyId: COMPANY },
    });
  });
  it("refuse une clé d'entreprise étrangère dans une clause unique", () => {
    expect(() => scopeArgs("Branch", "update", { where: { id: "b1", companyId: OTHER }, data: {} }, COMPANY)).toThrow();
    expect(() => scopeArgs("Company", "findUnique", { where: { id: OTHER } }, COMPANY)).toThrow();
  });
  it("estampille les créations et refuse les entreprises étrangères", () => {
    expect(scopeArgs("Branch", "create", { data: { name: "x" } }, COMPANY)).toEqual({ data: { name: "x", companyId: COMPANY } });
    expect(() => scopeArgs("Branch", "create", { data: { name: "x", companyId: OTHER } }, COMPANY)).toThrow();
    expect(() => scopeArgs("Branch", "create", { data: { name: "x", company: { connect: { id: OTHER } } } }, COMPANY)).toThrow();
  });
  it("estampille createMany", () => {
    const out = scopeArgs("Branch", "createMany", { data: [{ name: "a" }, { name: "b" }] }, COMPANY) as { data: { companyId: string }[] };
    expect(out.data.every((d) => d.companyId === COMPANY)).toBe(true);
  });
  it("interdit de changer l'entreprise d'une ligne existante", () => {
    expect(() => scopeArgs("Branch", "update", { where: { id: "b" }, data: { companyId: OTHER } }, COMPANY)).toThrow();
    expect(() => scopeArgs("Branch", "updateMany", { data: { companyId: OTHER } }, COMPANY)).toThrow();
  });
  it("interdit la création d'entreprise depuis un contexte tenant", () => {
    expect(() => scopeArgs("Company", "create", { data: {} }, COMPANY)).toThrow();
  });
  it("TENANT_KEY déclare Company par id", () => {
    expect(TENANT_KEY.Company).toBe("id");
  });
});
