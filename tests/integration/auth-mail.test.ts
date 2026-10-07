import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { makeUser, uid } from "../helpers";

// L'envoi d'e-mail échoue (clé Resend absente ou invalide, domaine non vérifié…)
const sendMail = vi.fn(async () => {
  throw new Error("Impossible d'envoyer l'e-mail.");
});
vi.mock("@/core/mail", () => ({ sendMail: (...args: unknown[]) => (sendMail as (...a: unknown[]) => Promise<void>)(...args), appUrl: (p = "") => `http://test${p}` }));

const { requestPasswordReset } = await import("@/core/auth/service");

describe("mot de passe oublié : échec d'envoi d'e-mail", () => {
  beforeEach(() => { sendMail.mockClear(); }); // bloc : un retour de fonction serait pris pour un nettoyage

  it("même réponse pour une adresse qui a un compte et pour une adresse inconnue (aucune divulgation)", async () => {
    const user = await makeUser();
    const known = await requestPasswordReset(user.email).then(() => "ok", () => "erreur");
    const unknown = await requestPasswordReset(`inconnu-${uid()}@x.y`).then(() => "ok", () => "erreur");
    expect(known).toBe("ok");
    expect(unknown).toBe("ok");
    expect(known).toBe(unknown);
  });

  it("tente bien l'envoi pour un compte existant (et jamais pour une adresse inconnue)", async () => {
    const user = await makeUser();
    await requestPasswordReset(user.email);
    expect(sendMail).toHaveBeenCalledTimes(1);
    sendMail.mockClear();
    await requestPasswordReset(`inconnu-${uid()}@x.y`);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("le jeton est tout de même créé : une fois l'envoi réparé, une nouvelle demande fonctionne", async () => {
    const user = await makeUser();
    await requestPasswordReset(user.email);
    const tokens = await platformDb.authToken.findMany({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null } });
    expect(tokens).toHaveLength(1);
    await requestPasswordReset(user.email);
    expect(await platformDb.authToken.count({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null } })).toBe(1); // un seul jeton actif
  });
});
