import "server-only";
import { audit } from "@/core/audit";
import { businessRule, forbidden, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";

type Ctx = Pick<TenantContext, "db" | "company" | "user" | "access" | "membership">;

export async function listMembers(ctx: Pick<TenantContext, "db">) {
  return ctx.db.companyMembership.findMany({
    orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
    include: {
      user: { select: { id: true, name: true, email: true, lastLoginAt: true, totpEnabledAt: true } },
      role: { select: { id: true, name: true, isAdmin: true } },
    },
  });
}

export async function listPendingInvitations(ctx: Pick<TenantContext, "db">) {
  return ctx.db.invitation.findMany({
    where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { role: { select: { name: true } } },
  });
}

async function loadTarget(ctx: Ctx, membershipId: string) {
  const target = await ctx.db.companyMembership.findFirst({
    where: { id: membershipId },
    include: { user: { select: { name: true, email: true } }, role: { select: { id: true, name: true, isAdmin: true } } },
  });
  if (!target) throw notFound("Membre");
  // Seul un administrateur peut agir sur un administrateur.
  if (target.role.isAdmin && !ctx.access.isAdmin) throw forbidden("Seul un administrateur peut modifier un administrateur.");
  return target;
}

async function assertAnotherAdminRemains(ctx: Ctx, excludingMembershipId: string) {
  const others = await ctx.db.companyMembership.count({
    where: { id: { not: excludingMembershipId }, status: "ACTIVE", role: { isAdmin: true } },
  });
  if (others === 0) throw businessRule("L'entreprise doit conserver au moins un administrateur actif.");
}

export async function changeMemberRole(ctx: Ctx, input: { membershipId: string; roleId: string }) {
  const target = await loadTarget(ctx, input.membershipId);
  const role = await ctx.db.role.findFirst({ where: { id: input.roleId } });
  if (!role) throw notFound("Rôle");
  if (role.isAdmin && !ctx.access.isAdmin) throw forbidden("Seul un administrateur peut attribuer le rôle Administrateur.");
  if (target.role.isAdmin && !role.isAdmin) await assertAnotherAdminRemains(ctx, target.id);

  await ctx.db.companyMembership.update({ where: { id: target.id }, data: { roleId: role.id } });
  await audit(ctx, {
    action: "member.role_change", resource: "CompanyMembership", resourceId: target.id,
    summary: `${ctx.user.name} a changé le rôle de ${target.user.name} : « ${target.role.name} » → « ${role.name} ».`,
    before: { role: target.role.name }, after: { role: role.name },
  });
}

export async function setMemberStatus(ctx: Ctx, input: { membershipId: string; status: "ACTIVE" | "SUSPENDED" }) {
  const target = await loadTarget(ctx, input.membershipId);
  if (target.isOwner) throw businessRule("Le propriétaire de l'entreprise ne peut pas être suspendu.");
  if (target.userId === ctx.user.id) throw businessRule("Vous ne pouvez pas suspendre votre propre accès.");
  if (input.status === "SUSPENDED" && target.role.isAdmin) await assertAnotherAdminRemains(ctx, target.id);

  await ctx.db.companyMembership.update({ where: { id: target.id }, data: { status: input.status } });
  await audit(ctx, {
    action: input.status === "SUSPENDED" ? "member.suspend" : "member.reactivate",
    resource: "CompanyMembership", resourceId: target.id,
    summary: `${ctx.user.name} a ${input.status === "SUSPENDED" ? "suspendu" : "réactivé"} l'accès de ${target.user.name}.`,
  });
}

export async function removeMember(ctx: Ctx, membershipId: string) {
  const target = await loadTarget(ctx, membershipId);
  if (target.isOwner) throw businessRule("Le propriétaire de l'entreprise ne peut pas être retiré.");
  if (target.role.isAdmin) await assertAnotherAdminRemains(ctx, target.id);

  await ctx.db.companyMembership.delete({ where: { id: target.id } });
  await audit(ctx, {
    action: "member.remove", resource: "CompanyMembership", resourceId: target.id,
    summary: `${ctx.user.name} a retiré ${target.user.name} (${target.user.email}) de l'entreprise.`,
  });
}

export async function revokeInvitation(ctx: Ctx, invitationId: string) {
  const inv = await ctx.db.invitation.findFirst({ where: { id: invitationId, acceptedAt: null, revokedAt: null } });
  if (!inv) throw notFound("Invitation");
  await ctx.db.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  await audit(ctx, { action: "invitation.revoke", resource: "Invitation", resourceId: inv.id, summary: `${ctx.user.name} a révoqué l'invitation de ${inv.email}.` });
}
