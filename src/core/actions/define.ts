import "server-only";
import { randomBytes } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getCurrentSession, type CurrentSession } from "@/core/auth/session";
import { Prisma } from "@/generated/prisma/client";
import { AppError, ok, unauthenticated, forbidden, type ActionResult } from "@/core/errors";
import { requireActionContext, type TenantContext } from "@/core/tenant/context";

/** Convertit n'importe quelle erreur en résultat uniforme ; ne divulgue jamais de détail interne. */
export function toActionError(error: unknown): ActionResult<never> {
  unstable_rethrow(error); // laisse passer redirect()/notFound() de Next

  if (error instanceof AppError) {
    return { ok: false, error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors } };
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Certaines données sont invalides.",
        fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
      },
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return { ok: false, error: { code: "CONFLICT", message: "Cette valeur existe déjà." } };
    }
    if (error.code === "P2025") {
      return { ok: false, error: { code: "NOT_FOUND", message: "Ressource introuvable." } };
    }
  }
  const ref = randomBytes(4).toString("hex");
  console.error(`[action:${ref}]`, error);
  return { ok: false, error: { code: "INTERNAL", message: `Une erreur est survenue. Référence : ${ref}.` } };
}

type PermissionSpec = string | readonly string[];

function assertPermissions(ctx: TenantContext, spec?: PermissionSpec) {
  if (!spec) return;
  for (const p of typeof spec === "string" ? [spec] : spec) ctx.assertCan(p);
}

/**
 * Server Action d'entreprise. Ordre imposé : authentification → membership/entreprise (serveur)
 * → module → permission → validation Zod → traitement. Le `companyId` n'est jamais une entrée.
 */
export function defineTenantAction<S extends z.ZodType, R>(config: {
  input: S;
  permission?: PermissionSpec;
  module?: string;
  handler: (args: { ctx: TenantContext; input: z.output<S> }) => Promise<R>;
}): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (raw) => {
    try {
      const ctx = await requireActionContext();
      if (config.module) ctx.assertModule(config.module);
      assertPermissions(ctx, config.permission);
      const input = config.input.parse(raw);
      return ok(await config.handler({ ctx, input }));
    } catch (e) {
      return toActionError(e);
    }
  };
}

/** Server Action pour un utilisateur connecté, sans entreprise (profil, sécurité, onboarding). */
export function defineUserAction<S extends z.ZodType, R>(config: {
  input: S;
  handler: (args: { session: CurrentSession; input: z.output<S> }) => Promise<R>;
}): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (raw) => {
    try {
      const session = await getCurrentSession();
      if (!session) throw unauthenticated();
      const input = config.input.parse(raw);
      return ok(await config.handler({ session, input }));
    } catch (e) {
      return toActionError(e);
    }
  };
}

/** Server Action réservée au propriétaire de la plateforme. */
export function definePlatformAction<S extends z.ZodType, R>(config: {
  input: S;
  handler: (args: { session: CurrentSession; input: z.output<S> }) => Promise<R>;
}): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (raw) => {
    try {
      const session = await getCurrentSession();
      if (!session) throw unauthenticated();
      if (!session.user.isPlatformAdmin) throw forbidden();
      const input = config.input.parse(raw);
      return ok(await config.handler({ session, input }));
    } catch (e) {
      return toActionError(e);
    }
  };
}

/** Server Action publique (inscription, demande de démo, mot de passe oublié…). */
export function definePublicAction<S extends z.ZodType, R>(config: {
  input: S;
  handler: (args: { input: z.output<S> }) => Promise<R>;
}): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (raw) => {
    try {
      const input = config.input.parse(raw);
      return ok(await config.handler({ input }));
    } catch (e) {
      return toActionError(e);
    }
  };
}
