import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { listRoles } from "@/modules/settings/roles";
import { listMembers, listPendingInvitations } from "@/modules/settings/members";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Paramètres — Utilisateurs" };

export default async function UsersSettingsPage() {
  const ctx = await requirePagePermission("users.member.read");
  const [members, invitations, roles, limits, usage] = await Promise.all([
    listMembers(ctx),
    listPendingInvitations(ctx),
    listRoles(ctx),
    getEffectiveLimits(ctx.company.id),
    getUsage(ctx.company.id),
  ]);
  const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

  return (
    <MembersPanel
      currentUserId={ctx.user.id}
      isAdmin={ctx.access.isAdmin}
      can={{ invite: ctx.can("users.member.invite"), update: ctx.can("users.member.update"), remove: ctx.can("users.member.remove") }}
      usage={{ used: usage.users, max: limits.users }}
      roles={roles.map((r) => ({ id: r.id, name: r.name, isAdmin: r.isAdmin }))}
      members={members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        roleId: m.roleId,
        roleName: m.role.name,
        roleIsAdmin: m.role.isAdmin,
        isOwner: m.isOwner,
        status: m.status,
        twoFactor: m.user.totpEnabledAt !== null,
        lastLogin: m.user.lastLoginAt ? dateFmt.format(m.user.lastLoginAt) : "Jamais",
      }))}
      invitations={invitations.map((i) => ({ id: i.id, email: i.email, roleName: i.role.name, expires: dateFmt.format(i.expiresAt) }))}
    />
  );
}
