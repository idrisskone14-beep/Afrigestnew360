"use server";

import { cookies } from "next/headers";
import { AuthError } from "next-auth";
import { definePublicAction, defineUserAction, toActionError } from "@/core/actions/define";
import { ok, type ActionResult } from "@/core/errors";
import { ACTIVE_COMPANY_COOKIE } from "@/core/tenant/context";
import { setActiveCompanyCookie } from "@/core/tenant/cookies";
import { acceptInvitation } from "@/core/tenant/invitations";
import { signIn, signOut } from "./auth";
import { getCurrentSession } from "./session";
import {
  acceptInvitationSchema, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema,
} from "./schemas";
import { enforceRateLimit } from "@/core/security/rate-limit";
import { registerUser, requestPasswordReset, resetPassword, revokeSession, verifyEmail } from "./service";
import { platformDb } from "@/core/db/client";
import { z } from "zod";

const LOGIN_MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou mot de passe incorrect.",
  account_locked: "Compte temporairement verrouillé après plusieurs échecs. Réessayez dans 15 minutes.",
  account_disabled: "Ce compte est désactivé. Contactez votre administrateur.",
  email_unverified: "Veuillez d'abord confirmer votre adresse e-mail (lien envoyé à l'inscription).",
  two_factor_required: "Entrez le code de votre application d'authentification.",
  invalid_two_factor: "Code d'authentification incorrect.",
};

/** Retourne ok(false) si un code 2FA est requis ; ok(true) si connecté. */
export async function loginAction(raw: unknown): Promise<ActionResult<{ twoFactorRequired: boolean; next: string }>> {
  try {
    const input = loginSchema.parse(raw);
    await enforceRateLimit("login", { limit: 30, windowMs: 15 * 60_000 });
    try {
      await signIn("credentials", { email: input.email, password: input.password, totp: input.totp ?? "", redirect: false });
    } catch (e) {
      if (e instanceof AuthError) {
        const code = (e as AuthError & { code?: string }).code ?? "invalid_credentials";
        if (code === "two_factor_required") return ok({ twoFactorRequired: true, next: "" });
        return { ok: false, error: { code: "UNAUTHENTICATED", message: LOGIN_MESSAGES[code] ?? LOGIN_MESSAGES.invalid_credentials! } };
      }
      throw e;
    }
    const safeNext = input.next && input.next.startsWith("/") && !input.next.startsWith("//") ? input.next : "/app";
    return ok({ twoFactorRequired: false, next: safeNext });
  } catch (e) {
    return toActionError(e);
  }
}

export async function logoutAction(): Promise<void> {
  const session = await getCurrentSession();
  if (session) await revokeSession(session.user.id, session.sessionId).catch(() => undefined);
  (await cookies()).delete(ACTIVE_COMPANY_COOKIE);
  await signOut({ redirectTo: "/connexion" });
}

export const registerAction = definePublicAction({
  input: registerSchema,
  handler: async ({ input }) => {
    await enforceRateLimit("register", { limit: 5, windowMs: 3_600_000 });
    await registerUser(input);
    return { email: input.email };
  },
});

export const forgotPasswordAction = definePublicAction({
  input: forgotPasswordSchema,
  handler: async ({ input }) => {
    await enforceRateLimit("forgot", { limit: 5, windowMs: 3_600_000 });
    await requestPasswordReset(input.email);
  },
});

export const resetPasswordAction = definePublicAction({
  input: resetPasswordSchema,
  handler: async ({ input }) => {
    await resetPassword(input.token, input.password);
  },
});

export const verifyEmailAction = definePublicAction({
  input: z.object({ token: z.string().min(10) }),
  handler: async ({ input }) => {
    await verifyEmail(input.token);
  },
});

export const resendVerificationAction = defineUserAction({
  input: z.object({}),
  handler: async ({ session }) => {
    const { sendVerificationEmail } = await import("./service");
    const user = await platformDb.user.findUniqueOrThrow({ where: { id: session.user.id } });
    if (!user.emailVerifiedAt) await sendVerificationEmail(user.id);
  },
});

export async function acceptInvitationAction(raw: unknown): Promise<ActionResult<{ companyId: string; mustLogin: boolean }>> {
  try {
    const input = acceptInvitationSchema.parse(raw);
    const session = await getCurrentSession();
    const res = await acceptInvitation({ ...input, currentUserId: session?.user.id });
    if (session) await setActiveCompanyCookie(res.companyId);
    return ok({ companyId: res.companyId, mustLogin: !session });
  } catch (e) {
    return toActionError(e);
  }
}
