import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginError, authenticateCredentials } from "@/core/auth/login";
import { platformDb } from "@/core/db/client";
import { AppError } from "@/core/errors";
import { getSignupMode, setSignupMode } from "@/core/platform-settings";
import { approveRegistration, countPendingRegistrations, listPendingRegistrations, rejectRegistration } from "@/modules/platform/registrations";
import { makeUser, uid } from "../helpers";

const sent: { to: string; subject: string }[] = [];
let failMail = false; // simule une panne d'envoi (clé Resend invalide, domaine non vérifié…)
vi.mock("@/core/mail", () => ({
  sendMail: async (m: { to: string; subject: string }) => { if (failMail) throw new Error("Impossible d'envoyer l'e-mail."); sent.push({ to: m.to, subject: m.subject }); },
  appUrl: (p = "") => `http://test${p}`,
}));
const { registerUser } = await import("@/core/auth/service");

const PASSWORD = "Passw0rd!Test";
const reason = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof LoginError ? e.reason : e instanceof AppError ? e.code : String(e)));
const newEmail = () => `inscrit-${uid()}@test.local`;

describe("inscription validée par le Super Admin", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    owner = await makeUser();
    await platformDb.user.update({ where: { id: owner.id }, data: { isPlatformAdmin: true } });
  });
  beforeEach(() => { sent.length = 0; failMail = false; });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await platformDb.platformSetting.deleteMany({ where: { key: "signup_mode" } }); // ne pas contaminer les autres fichiers de test
  });

  it("par défaut : confirmation par e-mail (comportement historique inchangé)", async () => {
    await platformDb.platformSetting.deleteMany({ where: { key: "signup_mode" } });
    expect(await getSignupMode()).toBe("email");
    const email = newEmail();
    const res = await registerUser({ name: "Jean Test", email, password: PASSWORD });
    expect(res.mode).toBe("email");
    const u = await platformDb.user.findUniqueOrThrow({ where: { email } });
    expect(u.status).toBe("ACTIVE");
    expect(sent.some((m) => m.to === email && /Confirmez/.test(m.subject))).toBe(true);
  });

  describe("mode « e-mail » : une panne d'envoi ne laisse jamais un compte inutilisable", () => {
    beforeAll(async () => { await platformDb.platformSetting.deleteMany({ where: { key: "signup_mode" } }); });

    it("l'e-mail ne part pas : pas d'erreur, le compte est mis en attente de validation et les administrateurs sont prévenus", async () => {
      const email = newEmail();
      failMail = true;
      const res = await registerUser({ name: "Panne Mail", email, password: PASSWORD });
      expect(res.mode).toBe("approval");
      const u = await platformDb.user.findUniqueOrThrow({ where: { email } });
      expect(u.status).toBe("PENDING");
      expect((await listPendingRegistrations()).map((r) => r.email)).toContain(email);
      expect(await reason(authenticateCredentials({ email, password: PASSWORD }))).toBe("account_pending");
    });

    it("même forme de réponse pour une adresse déjà connue (aucune divulgation), en panne comme en fonctionnement normal", async () => {
      const known = await makeUser();
      failMail = true;
      expect((await registerUser({ name: "X Y", email: known.email, password: PASSWORD })).mode).toBe("approval");
      failMail = false;
      expect((await registerUser({ name: "X Y", email: known.email, password: PASSWORD })).mode).toBe("email");
      expect((await registerUser({ name: "Nouveau Compte", email: newEmail(), password: PASSWORD })).mode).toBe("email");
    });

    it("sans clé d'envoi en production, le mode effectif passe tout seul en validation (le choix affiché reste « e-mail »)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("RESEND_API_KEY", "");
      expect(await getSignupMode()).toBe("approval");
      const email = newEmail();
      expect((await registerUser({ name: "Sans Clé", email, password: PASSWORD })).mode).toBe("approval");
      expect((await platformDb.user.findUniqueOrThrow({ where: { email } })).status).toBe("PENDING");
      vi.stubEnv("RESEND_API_KEY", "re_test");
      expect(await getSignupMode()).toBe("email");
      vi.unstubAllEnvs();
    });

    it("un compte déjà bloqué (actif, adresse jamais confirmée, jamais connecté) apparaît dans la liste et se débloque en un clic", async () => {
      const stuck = await makeUser();
      await platformDb.user.update({ where: { id: stuck.id }, data: { emailVerifiedAt: null } });
      const row = (await listPendingRegistrations()).find((r) => r.id === stuck.id);
      expect(row?.kind).toBe("unverified");
      await approveRegistration(stuck.id);
      expect((await platformDb.user.findUniqueOrThrow({ where: { id: stuck.id } })).emailVerifiedAt).not.toBeNull();
      expect((await listPendingRegistrations()).some((r) => r.id === stuck.id)).toBe(false);
    });

    it("la liste ne contient ni un compte vérifié, ni un compte déjà utilisé, ni un administrateur de plateforme", async () => {
      const verified = await makeUser();
      const used = await makeUser();
      await platformDb.user.update({ where: { id: used.id }, data: { emailVerifiedAt: null, lastLoginAt: new Date() } });
      const ids = (await listPendingRegistrations()).map((r) => r.id);
      expect(ids).not.toContain(verified.id);
      expect(ids).not.toContain(used.id);
      expect(ids).not.toContain(owner.id);
      await expect(approveRegistration(verified.id)).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("mode « validation par le Super Admin »", () => {
    beforeAll(async () => { await setSignupMode("approval", owner.id); });

    it("le réglage est lu depuis la base", async () => {
      expect(await getSignupMode()).toBe("approval");
    });

    it("l'inscription crée un compte EN ATTENTE, sans e-mail à l'inscrit, et prévient les administrateurs", async () => {
      const email = newEmail();
      const res = await registerUser({ name: "Awa Attente", email, password: PASSWORD });
      expect(res.mode).toBe("approval");
      const u = await platformDb.user.findUniqueOrThrow({ where: { email } });
      expect(u.status).toBe("PENDING");
      expect(u.emailVerifiedAt).toBeNull();
      expect(sent.some((m) => m.to === email)).toBe(false); // aucun e-mail n'est exigé de l'inscrit
      expect(sent.some((m) => m.to === owner.email && /à valider/.test(m.subject))).toBe(true);
      expect((await listPendingRegistrations()).map((r) => r.email)).toContain(email);
      expect(await countPendingRegistrations()).toBeGreaterThan(0);
    });

    it("un compte en attente ne peut pas se connecter, mais seulement avec le BON mot de passe (pas de fuite)", async () => {
      const email = newEmail();
      await registerUser({ name: "Moussa Attente", email, password: PASSWORD });
      expect(await reason(authenticateCredentials({ email, password: PASSWORD }))).toBe("account_pending");
      expect(await reason(authenticateCredentials({ email, password: "Mauvais#Mot2Passe" }))).toBe("invalid_credentials");
      expect(await reason(authenticateCredentials({ email: newEmail(), password: PASSWORD }))).toBe("invalid_credentials");
      expect(await platformDb.userSession.count({ where: { user: { email } } })).toBe(0); // aucune session créée
    });

    it("même réponse pour une adresse déjà connue : aucun doublon, aucun e-mail, aucune divulgation", async () => {
      const known = await makeUser();
      const before = await platformDb.user.count();
      const res = await registerUser({ name: "Quelqu'un", email: known.email, password: PASSWORD });
      expect(res.mode).toBe("approval");
      expect(await platformDb.user.count()).toBe(before);
      expect(sent).toHaveLength(0);
      expect((await platformDb.user.findUniqueOrThrow({ where: { id: known.id } })).status).toBe("ACTIVE"); // le compte existant n'est pas touché
    });

    it("la validation active le compte, tient l'adresse pour vérifiée et permet la connexion", async () => {
      const email = newEmail();
      await registerUser({ name: "Fatou Validée", email, password: PASSWORD });
      const u = await platformDb.user.findUniqueOrThrow({ where: { email } });
      sent.length = 0;
      await approveRegistration(u.id);
      const after = await platformDb.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(after.status).toBe("ACTIVE");
      expect(after.emailVerifiedAt).not.toBeNull();
      expect(sent.some((m) => m.to === email && /validé/.test(m.subject))).toBe(true);
      expect(await reason(authenticateCredentials({ email, password: PASSWORD }))).toBe("ok");
      expect((await listPendingRegistrations()).map((r) => r.email)).not.toContain(email);
    });

    it("le refus désactive le compte : connexion et réinscription impossibles", async () => {
      const email = newEmail();
      await registerUser({ name: "Koffi Refusé", email, password: PASSWORD });
      const u = await platformDb.user.findUniqueOrThrow({ where: { email } });
      await rejectRegistration(u.id);
      expect((await platformDb.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("DISABLED");
      expect(await reason(authenticateCredentials({ email, password: PASSWORD }))).toBe("account_disabled");
      await registerUser({ name: "Koffi Refusé", email, password: PASSWORD }); // même réponse, sans effet
      expect((await platformDb.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("DISABLED");
    });

    it("une inscription ne se traite qu'une fois (double clic, deux administrateurs, compte actif)", async () => {
      const email = newEmail();
      await registerUser({ name: "Double Clic", email, password: PASSWORD });
      const u = await platformDb.user.findUniqueOrThrow({ where: { email } });
      const results = await Promise.allSettled([approveRegistration(u.id), approveRegistration(u.id), rejectRegistration(u.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); // une seule décision l'emporte
      await expect(approveRegistration(u.id)).rejects.toMatchObject({ code: "CONFLICT" });
      const active = await makeUser();
      await expect(approveRegistration(active.id)).rejects.toMatchObject({ code: "CONFLICT" }); // on ne « valide » pas un compte actif
      await expect(approveRegistration("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("un échec d'envoi d'e-mail n'annule pas la décision", async () => {
      const email = newEmail();
      await registerUser({ name: "Mail Cassé", email, password: PASSWORD });
      const u = await platformDb.user.findUniqueOrThrow({ where: { email } });
      const mail = await import("@/core/mail");
      const spy = vi.spyOn(mail, "sendMail").mockRejectedValueOnce(new Error("Resend indisponible"));
      await approveRegistration(u.id);
      spy.mockRestore();
      expect((await platformDb.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("ACTIVE");
    });
  });
});
