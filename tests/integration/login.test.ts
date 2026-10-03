import { describe, expect, it } from "vitest";
import { encryptSecret, hashToken } from "@/core/auth/crypto";
import { LoginError, authenticateCredentials } from "@/core/auth/login";
import { generateTotpSecret, totp } from "@/core/auth/totp";
import { platformDb } from "@/core/db/client";
import { makeUser, uid } from "../helpers";

const PASSWORD = "Passw0rd!Test";
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as LoginError | null;

describe("authentification", () => {
  it("crée une session révocable à la connexion", async () => {
    const u = await makeUser();
    const res = await authenticateCredentials({ email: u.email.toUpperCase(), password: PASSWORD, ip: "1.2.3.4", userAgent: "vitest" });
    const s = await platformDb.userSession.findUniqueOrThrow({ where: { id: res.sessionId } });
    expect(s.userId).toBe(u.id);
    expect(s.revokedAt).toBeNull();
    expect(s.ip).toBe("1.2.3.4");
  });

  it("refuse mot de passe incorrect et utilisateur inconnu avec la même erreur", async () => {
    const u = await makeUser();
    expect((await fail(authenticateCredentials({ email: u.email, password: "mauvais" })))?.reason).toBe("invalid_credentials");
    expect((await fail(authenticateCredentials({ email: `nobody-${uid()}@x.y`, password: "x" })))?.reason).toBe("invalid_credentials");
  });

  it("verrouille le compte après 5 échecs", async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await fail(authenticateCredentials({ email: u.email, password: "mauvais" }));
    expect((await fail(authenticateCredentials({ email: u.email, password: PASSWORD })))?.reason).toBe("account_locked");
  });

  it("refuse un compte désactivé", async () => {
    const u = await makeUser();
    await platformDb.user.update({ where: { id: u.id }, data: { status: "DISABLED" } });
    expect((await fail(authenticateCredentials({ email: u.email, password: PASSWORD })))?.reason).toBe("account_disabled");
  });

  it("exige la vérification e-mail quand configurée", async () => {
    const u = await makeUser();
    await platformDb.user.update({ where: { id: u.id }, data: { emailVerifiedAt: null } });
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    try {
      expect((await fail(authenticateCredentials({ email: u.email, password: PASSWORD })))?.reason).toBe("email_unverified");
    } finally {
      process.env.REQUIRE_EMAIL_VERIFICATION = "false";
    }
  });

  describe("2FA", () => {
    const setup = async () => {
      const u = await makeUser();
      const secret = generateTotpSecret();
      await platformDb.user.update({
        where: { id: u.id },
        data: { totpSecretEnc: encryptSecret(secret), totpEnabledAt: new Date(), recoveryCodes: [hashToken("AAAAA-BBBBB")] },
      });
      return { u, secret };
    };

    it("demande le code puis accepte un TOTP valide", async () => {
      const { u, secret } = await setup();
      expect((await fail(authenticateCredentials({ email: u.email, password: PASSWORD })))?.reason).toBe("two_factor_required");
      expect((await fail(authenticateCredentials({ email: u.email, password: PASSWORD, totp: "000000" })))?.reason).toBe("invalid_two_factor");
      const ok = await authenticateCredentials({ email: u.email, password: PASSWORD, totp: totp(secret) });
      expect(ok.userId).toBe(u.id);
    });

    it("le code de secours ne fonctionne qu'une fois", async () => {
      const { u } = await setup();
      await authenticateCredentials({ email: u.email, password: PASSWORD, totp: "aaaaa-bbbbb" });
      expect((await fail(authenticateCredentials({ email: u.email, password: PASSWORD, totp: "AAAAA-BBBBB" })))?.reason).toBe("invalid_two_factor");
    });
  });
});
