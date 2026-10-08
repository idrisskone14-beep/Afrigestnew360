import "server-only";
import QRCode from "qrcode";
import { platformDb } from "@/core/db/client";
import { AppError, businessRule, conflict } from "@/core/errors";
import { appUrl, sendMail } from "@/core/mail";
import { getSignupMode, type SignupMode } from "@/core/platform-settings";
import { decryptSecret, encryptSecret, generateToken, hashToken } from "./crypto";
import { normalizeEmail } from "./login";
import { hashPassword, verifyPassword } from "./password";
import { generateRecoveryCodes, generateTotpSecret, totpUri, verifyTotp } from "./totp";

const HOUR = 3_600_000;
const TOKEN_TTL = { EMAIL_VERIFY: 48 * HOUR, PASSWORD_RESET: 1 * HOUR } as const;

async function issueToken(email: string, userId: string, type: keyof typeof TOKEN_TTL) {
  // un seul jeton actif par type
  await platformDb.authToken.deleteMany({ where: { userId, type, usedAt: null } });
  const { token, hash } = generateToken();
  await platformDb.authToken.create({
    data: { userId, email, type, tokenHash: hash, expiresAt: new Date(Date.now() + TOKEN_TTL[type]) },
  });
  return token;
}

async function consumeToken(token: string, type: keyof typeof TOKEN_TTL) {
  const row = await platformDb.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date() || !row.userId) {
    throw new AppError("VALIDATION", "Ce lien est invalide ou a expiré.");
  }
  await platformDb.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row;
}

export async function sendVerificationEmail(userId: string) {
  const user = await platformDb.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await issueToken(user.email, user.id, "EMAIL_VERIFY");
  await sendMail({
    to: user.email,
    subject: "Confirmez votre adresse e-mail — AfriGest 360",
    text: `Bonjour ${user.name},\n\nConfirmez votre adresse e-mail :\n${appUrl(`/verifier-email?token=${token}`)}\n\nCe lien est valable 48 heures.`,
  });
}

/** Prévient les administrateurs de la plateforme qu'une inscription attend leur validation (au mieux : un échec n'annule rien). */
async function notifyPlatformAdminsOfRegistration(name: string, email: string) {
  try {
    const admins = await platformDb.user.findMany({ where: { isPlatformAdmin: true, status: "ACTIVE", deletedAt: null }, select: { email: true } });
    await Promise.all(admins.map((a) => sendMail({
      to: a.email,
      subject: "Nouvelle inscription à valider — AfriGest 360",
      text: `${name} (${email}) vient de s'inscrire et attend votre validation :\n${appUrl("/super-admin/inscriptions")}`,
    }).catch((e) => console.error("[inscription] notification non envoyée", e))));
  } catch (e) {
    console.error("[inscription] notification non envoyée", e);
  }
}

/**
 * Inscription. Deux modes (réglage plateforme, voir core/platform-settings.ts) :
 *  - "email"    : compte actif, confirmation de l'adresse par e-mail ;
 *  - "approval" : AUCUN e-mail requis ; le compte est créé « en attente » et n'ouvre qu'après validation par le Super Admin.
 * Dans les deux modes la réponse est identique que l'adresse soit déjà connue ou non (pas de divulgation de comptes).
 */
export async function registerUser(input: { name: string; email: string; password: string }): Promise<{ mode: SignupMode }> {
  const email = normalizeEmail(input.email);
  const mode = await getSignupMode();
  const existing = await platformDb.user.findUnique({ where: { email } });
  if (mode === "approval") {
    if (!existing) {
      const name = input.name.trim();
      await platformDb.user.create({ data: { email, name, passwordHash: await hashPassword(input.password), status: "PENDING" } });
      await notifyPlatformAdminsOfRegistration(name, email);
    }
    return { mode };
  }
  if (existing) {
    // Pas de divulgation de l'existence du compte : même réponse que l'inscription réussie.
    await sendMail({
      to: email,
      subject: "Tentative d'inscription — AfriGest 360",
      text: `Une inscription a été tentée avec cette adresse alors qu'un compte existe déjà.\nConnectez-vous : ${appUrl("/connexion")}\nMot de passe oublié : ${appUrl("/mot-de-passe-oublie")}`,
    });
    return { mode };
  }
  const user = await platformDb.user.create({
    data: { email, name: input.name.trim(), passwordHash: await hashPassword(input.password) },
  });
  await sendVerificationEmail(user.id);
  return { mode };
}

export async function verifyEmail(token: string) {
  const row = await consumeToken(token, "EMAIL_VERIFY");
  await platformDb.user.update({ where: { id: row.userId! }, data: { emailVerifiedAt: new Date() } });
}

export async function requestPasswordReset(emailRaw: string) {
  const user = await platformDb.user.findUnique({ where: { email: normalizeEmail(emailRaw) } });
  if (!user || user.status !== "ACTIVE" || user.deletedAt) return; // réponse identique dans tous les cas
  const token = await issueToken(user.email, user.id, "PASSWORD_RESET");
  try {
    await sendMail({
      to: user.email,
      subject: "Réinitialisation de votre mot de passe — AfriGest 360",
      text: `Pour choisir un nouveau mot de passe :\n${appUrl(`/reinitialiser-mot-de-passe?token=${token}`)}\n\nCe lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    });
  } catch (e) {
    // Un échec d'envoi (clé Resend absente ou invalide, domaine non vérifié…) ne doit PAS se voir côté utilisateur : une erreur
    // affichée uniquement pour les adresses qui ont un compte révélerait lesquelles existent. On journalise pour l'exploitant.
    console.error("[auth] lien de réinitialisation non envoyé (voir [mail] ci-dessus)", e);
  }
}

export async function resetPassword(token: string, newPassword: string) {
  const row = await consumeToken(token, "PASSWORD_RESET");
  const userId = row.userId!;
  await platformDb.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null },
  });
  await revokeSessions(userId); // toutes les sessions existantes sont fermées
}

export async function revokeSessions(userId: string, exceptSessionId?: string) {
  await platformDb.userSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function revokeSession(userId: string, sessionId: string) {
  const res = await platformDb.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) throw new AppError("NOT_FOUND", "Session introuvable.");
}

export async function changePassword(userId: string, current: string, next: string, keepSessionId: string) {
  const user = await platformDb.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new AppError("VALIDATION", "Mot de passe actuel incorrect.", { currentPassword: ["Mot de passe actuel incorrect"] });
  }
  await platformDb.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await revokeSessions(userId, keepSessionId);
}

export async function listSessions(userId: string) {
  return platformDb.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
  });
}

// ── 2FA (TOTP) ────────────────────────────────────────────────

export async function beginTwoFactorSetup(userId: string) {
  const user = await platformDb.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabledAt) throw conflict("L'authentification à deux facteurs est déjà activée.");
  const secret = generateTotpSecret();
  await platformDb.user.update({ where: { id: userId }, data: { totpSecretEnc: encryptSecret(secret), totpEnabledAt: null } });
  const uri = totpUri(secret, user.email);
  return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/** Confirme la configuration avec un premier code ; renvoie les codes de secours (affichés UNE fois). */
export async function confirmTwoFactorSetup(userId: string, code: string) {
  const user = await platformDb.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpSecretEnc || user.totpEnabledAt) throw businessRule("Aucune configuration en cours.");
  if (!verifyTotp(decryptSecret(user.totpSecretEnc), code)) {
    throw new AppError("VALIDATION", "Code incorrect.", { code: ["Code incorrect"] });
  }
  const recoveryCodes = generateRecoveryCodes();
  await platformDb.user.update({
    where: { id: userId },
    data: { totpEnabledAt: new Date(), recoveryCodes: recoveryCodes.map((c) => hashToken(c)) },
  });
  return recoveryCodes;
}

export async function disableTwoFactor(userId: string, password: string, code: string) {
  const user = await platformDb.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpEnabledAt || !user.totpSecretEnc) throw businessRule("L'authentification à deux facteurs n'est pas activée.");
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AppError("VALIDATION", "Mot de passe incorrect.", { password: ["Mot de passe incorrect"] });
  }
  const recovery = user.recoveryCodes.includes(hashToken(code.trim().toUpperCase()));
  if (!recovery && !verifyTotp(decryptSecret(user.totpSecretEnc), code.trim())) {
    throw new AppError("VALIDATION", "Code incorrect.", { code: ["Code incorrect"] });
  }
  await platformDb.user.update({
    where: { id: userId },
    data: { totpEnabledAt: null, totpSecretEnc: null, recoveryCodes: [] },
  });
}
