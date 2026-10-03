import "server-only";
import { generateToken, hashToken } from "@/core/auth/crypto";
import { normalizeEmail } from "@/core/auth/login";
import { hashPassword } from "@/core/auth/password";
import { platformDb, platformTransaction } from "@/core/db/client";
import { AppError, businessRule, conflict, forbidden, notFound } from "@/core/errors";
import { appUrl, sendMail } from "@/core/mail";
import { assertWithinLimit, getEffectiveLimits, getUsage } from "@/core/modules/limits";
import type { TenantContext } from "./context";

const INVITATION_TTL_MS = 7 * 24 * 3_600_000;

export async function createInvitation(ctx: TenantContext, input: { email: string; roleId: string }) {
  const email = normalizeEmail(input.email);

  const role = await ctx.db.role.findFirst({ where: { id: input.roleId } });
  if (!role) throw notFound("Rôle");
  if (role.isAdmin && !ctx.access.isAdmin) throw forbidden("Seul un administrateur peut inviter avec le rôle Administrateur.");

  const existingUser = await platformDb.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    const member = await ctx.db.companyMembership.findFirst({ where: { userId: existingUser.id } });
    if (member) throw conflict("Cette personne est déjà membre de l'entreprise.");
  }

  const [limits, usage] = await Promise.all([getEffectiveLimits(ctx.company.id), getUsage(ctx.company.id)]);
  assertWithinLimit(limits, "users", usage.users);

  // invitation active précédente pour la même adresse → révoquée
  await ctx.db.invitation.updateMany({
    where: { email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const { token, hash } = generateToken();
  const invitation = await ctx.db.invitation.create({
    data: {
      companyId: ctx.company.id,
      email,
      roleId: role.id,
      tokenHash: hash,
      invitedById: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });

  const companyName = ctx.company.tradeName ?? ctx.company.legalName;
  await sendMail({
    to: email,
    subject: `${ctx.user.name} vous invite à rejoindre ${companyName} sur AfriGest 360`,
    text: `${ctx.user.name} vous invite à rejoindre « ${companyName} » avec le rôle « ${role.name} ».\n\nAccepter l'invitation :\n${appUrl(`/invitation/${token}`)}\n\nCe lien est valable 7 jours.`,
  });
  return invitation;
}

async function findValid(token: string) {
  const inv = await platformDb.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { company: { select: { id: true, legalName: true, tradeName: true, status: true } }, role: { select: { name: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.company.status !== "ACTIVE") return null;
  return inv;
}

export async function previewInvitation(token: string) {
  const inv = await findValid(token);
  if (!inv) return null;
  const user = await platformDb.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return {
    email: inv.email,
    companyName: inv.company.tradeName ?? inv.company.legalName,
    roleName: inv.role.name,
    userExists: Boolean(user),
  };
}

/**
 * Accepte une invitation. Utilisateur existant : doit être connecté avec l'adresse invitée.
 * Nouvel utilisateur : crée le compte (adresse prouvée par le lien → e-mail vérifié).
 */
export async function acceptInvitation(input: { token: string; name?: string; password?: string; currentUserId?: string }) {
  const inv = await findValid(input.token);
  if (!inv) throw new AppError("VALIDATION", "Cette invitation est invalide ou a expiré.");

  return platformTransaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: inv.email } });
    if (user) {
      if (input.currentUserId !== user.id) {
        throw new AppError("FORBIDDEN", `Connectez-vous avec ${inv.email} pour accepter cette invitation.`);
      }
    } else {
      if (!input.name || !input.password) throw businessRule("Nom et mot de passe requis pour créer votre compte.");
      user = await tx.user.create({
        data: { email: inv.email, name: input.name.trim(), passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() },
      });
    }
    await tx.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: inv.companyId } },
      create: { userId: user.id, companyId: inv.companyId, roleId: inv.roleId },
      update: { roleId: inv.roleId, status: "ACTIVE" },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    return { companyId: inv.companyId, userId: user.id, isNewUser: !input.currentUserId };
  });
}
