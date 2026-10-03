"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction, defineUserAction } from "@/core/actions/define";
import { audit } from "@/core/audit";
import {
  beginTwoFactorSetup, changePassword, confirmTwoFactorSetup, disableTwoFactor, revokeSession, revokeSessions,
} from "@/core/auth/service";
import { changePasswordSchema, disableTotpSchema, totpCodeSchema } from "@/core/auth/schemas";
import { createInvitation } from "@/core/tenant/invitations";
import { companySettingsSchema } from "@/core/tenant/schemas";
import { z } from "zod";
import { changeMemberRole, removeMember, revokeInvitation, setMemberStatus } from "./members";
import { createRole, deleteRole, updateRole } from "./roles";
import {
  changeRoleSchema, createRoleSchema, inviteMemberSchema, invitationIdSchema, memberStatusSchema, membershipIdSchema,
  notificationPrefsSchema, roleIdSchema, updateRoleSchema, NOTIFICATION_TYPES,
} from "./schemas";

const refresh = (path: string) => revalidatePath(path);

// ── Entreprise ────────────────────────────────────────────────

export const updateCompanyAction = defineTenantAction({
  input: companySettingsSchema,
  permission: "settings.company.update",
  handler: async ({ ctx, input }) => {
    const before = await ctx.db.company.findFirstOrThrow({ where: { id: ctx.company.id } });
    const clean = (v?: string) => (v && v.length > 0 ? v : null);
    const after = await ctx.db.company.update({
      where: { id: ctx.company.id },
      data: {
        legalName: input.legalName,
        tradeName: clean(input.tradeName),
        legalForm: clean(input.legalForm),
        email: clean(input.email),
        phone: clean(input.phone),
        address: clean(input.address),
        city: clean(input.city),
        country: input.country,
        rccm: clean(input.rccm),
        taxId: clean(input.taxId),
        sector: clean(input.sector),
        size: clean(input.size),
        currency: input.currency,
        timezone: input.timezone,
        fiscalYearStartMonth: input.fiscalYearStartMonth,
      },
    });
    await audit(ctx, {
      action: "company.update", resource: "Company", resourceId: ctx.company.id,
      summary: `${ctx.user.name} a modifié les paramètres de l'entreprise.`,
      before, after,
    });
    refresh("/app");
  },
});

// ── Membres ───────────────────────────────────────────────────

export const inviteMemberAction = defineTenantAction({
  input: inviteMemberSchema,
  permission: "users.member.invite",
  handler: async ({ ctx, input }) => {
    const inv = await createInvitation(ctx, input);
    await audit(ctx, { action: "invitation.create", resource: "Invitation", resourceId: inv.id, summary: `${ctx.user.name} a invité ${inv.email}.`, after: { email: inv.email, roleId: inv.roleId } });
    refresh("/app/parametres/utilisateurs");
  },
});

export const revokeInvitationAction = defineTenantAction({
  input: invitationIdSchema,
  permission: "users.member.invite",
  handler: async ({ ctx, input }) => {
    await revokeInvitation(ctx, input.invitationId);
    refresh("/app/parametres/utilisateurs");
  },
});

export const changeMemberRoleAction = defineTenantAction({
  input: changeRoleSchema,
  permission: "users.member.update",
  handler: async ({ ctx, input }) => {
    await changeMemberRole(ctx, input);
    refresh("/app/parametres/utilisateurs");
  },
});

export const setMemberStatusAction = defineTenantAction({
  input: memberStatusSchema,
  permission: "users.member.update",
  handler: async ({ ctx, input }) => {
    await setMemberStatus(ctx, input);
    refresh("/app/parametres/utilisateurs");
  },
});

export const removeMemberAction = defineTenantAction({
  input: membershipIdSchema,
  permission: "users.member.remove",
  handler: async ({ ctx, input }) => {
    await removeMember(ctx, input.membershipId);
    refresh("/app/parametres/utilisateurs");
  },
});

// ── Rôles ─────────────────────────────────────────────────────

export const createRoleAction = defineTenantAction({
  input: createRoleSchema,
  permission: "roles.role.manage",
  handler: async ({ ctx, input }) => {
    const role = await createRole(ctx, input);
    refresh("/app/parametres/roles");
    return { id: role.id };
  },
});

export const updateRoleAction = defineTenantAction({
  input: updateRoleSchema,
  permission: "roles.role.manage",
  handler: async ({ ctx, input }) => {
    await updateRole(ctx, input);
    refresh("/app/parametres/roles");
  },
});

export const deleteRoleAction = defineTenantAction({
  input: roleIdSchema,
  permission: "roles.role.manage",
  handler: async ({ ctx, input }) => {
    await deleteRole(ctx, input.roleId);
    refresh("/app/parametres/roles");
  },
});

// ── Notifications (préférences personnelles) ──────────────────

export const saveNotificationPrefsAction = defineTenantAction({
  input: notificationPrefsSchema,
  handler: async ({ ctx, input }) => {
    const known = new Set<string>(NOTIFICATION_TYPES.map((t) => t.type));
    await ctx.tx(async (tx) => {
      for (const p of input.prefs.filter((x) => known.has(x.type))) {
        await tx.notificationPreference.upsert({
          where: { companyId_userId_type: { companyId: ctx.company.id, userId: ctx.user.id, type: p.type } },
          create: { companyId: ctx.company.id, userId: ctx.user.id, type: p.type, inApp: p.inApp, email: p.email },
          update: { inApp: p.inApp, email: p.email },
        });
      }
    });
  },
});

// ── Sécurité du compte ────────────────────────────────────────

export const changePasswordAction = defineUserAction({
  input: changePasswordSchema,
  handler: async ({ session, input }) => {
    await changePassword(session.user.id, input.currentPassword, input.password, session.sessionId);
    refresh("/app/parametres/securite");
  },
});

export const beginTwoFactorAction = defineUserAction({
  input: z.object({}),
  handler: async ({ session }) => beginTwoFactorSetup(session.user.id),
});

export const confirmTwoFactorAction = defineUserAction({
  input: totpCodeSchema,
  handler: async ({ session, input }) => {
    const recoveryCodes = await confirmTwoFactorSetup(session.user.id, input.code);
    refresh("/app/parametres/securite");
    return { recoveryCodes };
  },
});

export const disableTwoFactorAction = defineUserAction({
  input: disableTotpSchema,
  handler: async ({ session, input }) => {
    await disableTwoFactor(session.user.id, input.password, input.code);
    refresh("/app/parametres/securite");
  },
});

export const revokeSessionAction = defineUserAction({
  input: z.object({ sessionId: z.string().uuid() }),
  handler: async ({ session, input }) => {
    await revokeSession(session.user.id, input.sessionId);
    refresh("/app/parametres/securite");
  },
});

export const revokeOtherSessionsAction = defineUserAction({
  input: z.object({}),
  handler: async ({ session }) => {
    await revokeSessions(session.user.id, session.sessionId);
    refresh("/app/parametres/securite");
  },
});
