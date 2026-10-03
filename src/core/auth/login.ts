import "server-only";
import { platformDb } from "@/core/db/client";
import { decryptSecret, hashToken, safeEqual } from "./crypto";
import { dummyVerify, verifyPassword } from "./password";
import { verifyTotp } from "./totp";

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export type LoginFailure =
  | "invalid_credentials"
  | "account_locked"
  | "account_disabled"
  | "email_unverified"
  | "two_factor_required"
  | "invalid_two_factor";

export class LoginError extends Error {
  constructor(readonly reason: LoginFailure) {
    super(reason);
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeRecovery = (code: string) => code.trim().toUpperCase().replace(/\s/g, "");

export interface LoginInput {
  email: string;
  password: string;
  /** Code TOTP à 6 chiffres ou code de secours. */
  totp?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginSuccess {
  userId: string;
  name: string;
  email: string;
  sessionId: string;
}

export function requireEmailVerification(): boolean {
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}

/** Vérifie les identifiants, applique verrouillage + 2FA, et crée une session révocable. */
export async function authenticateCredentials(input: LoginInput): Promise<LoginSuccess> {
  const email = normalizeEmail(input.email);
  const user = await platformDb.user.findUnique({ where: { email } });

  if (!user || user.deletedAt) {
    await dummyVerify(input.password);
    throw new LoginError("invalid_credentials");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new LoginError("account_locked");

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) {
    await registerFailure(user.id, user.failedLoginCount + 1);
    throw new LoginError("invalid_credentials");
  }
  if (user.status !== "ACTIVE") throw new LoginError("account_disabled");
  if (requireEmailVerification() && !user.emailVerifiedAt) throw new LoginError("email_unverified");

  if (user.totpEnabledAt && user.totpSecretEnc) {
    const code = input.totp?.trim();
    if (!code) throw new LoginError("two_factor_required");
    const secret = decryptSecret(user.totpSecretEnc);
    let accepted = verifyTotp(secret, code);
    let remainingCodes = user.recoveryCodes;
    if (!accepted) {
      const hashed = hashToken(normalizeRecovery(code));
      const match = user.recoveryCodes.find((c) => safeEqual(c, hashed));
      if (match) {
        accepted = true;
        remainingCodes = user.recoveryCodes.filter((c) => c !== match);
      }
    }
    if (!accepted) {
      await registerFailure(user.id, user.failedLoginCount + 1);
      throw new LoginError("invalid_two_factor");
    }
    if (remainingCodes.length !== user.recoveryCodes.length) {
      await platformDb.user.update({ where: { id: user.id }, data: { recoveryCodes: remainingCodes } });
    }
  }

  const created = await platformDb.userSession.create({
    data: {
      userId: user.id,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    },
  });
  await platformDb.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  return { userId: user.id, name: user.name, email: user.email, sessionId: created.id };
}

async function registerFailure(userId: string, count: number) {
  await platformDb.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: count,
      lockedUntil: count >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
    },
  });
}
