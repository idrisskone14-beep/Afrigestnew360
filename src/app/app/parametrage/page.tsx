import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { requireTenantContext } from "@/core/tenant/guards";
import { listMembers, listPendingInvitations } from "@/modules/settings/members";
import { listRoles } from "@/modules/settings/roles";
import { MembersPanel } from "../parametres/utilisateurs/members-panel";
import { SetupWizard, type SetupInitial } from "./setup-wizard";

export const metadata: Metadata = { title: "Paramétrage de l'entreprise" };

const num = (v: { toString(): string } | null) => (v === null ? "" : Number(v.toString()));

/** Parcours de paramétrage du dossier de l'entreprise : proposé à l'administrateur à sa première connexion, modifiable ensuite. */
export default async function SetupPage() {
  const ctx = await requireTenantContext();
  if (!ctx.can("settings.company.update")) redirect("/app/dashboard");
  const c = await ctx.db.company.findFirstOrThrow({ where: { id: ctx.company.id } });

  const initial: SetupInitial = {
    identification: {
      legalName: c.legalName, tradeName: c.tradeName ?? "", acronym: c.acronym ?? "", legalForm: c.legalForm ?? "",
      shareCapital: num(c.shareCapital), sector: c.sector ?? "", activityDescription: c.activityDescription ?? "",
      accountingFramework: c.accountingFramework ?? "SYSCOHADA révisé", rccm: c.rccm ?? "", country: c.country,
      address: c.address ?? "", commune: c.commune ?? "", city: c.city ?? "", postalCode: c.postalCode ?? "",
      email: c.email ?? "", phone: c.phone ?? "",
    },
    fiscal: {
      taxId: c.taxId ?? "", taxRegime: c.taxRegime ?? "", activityStartDate: c.activityStartDate ? c.activityStartDate.toISOString().slice(0, 10) : "",
      vatFrequency: c.vatFrequency ?? "", vatRof: c.vatRof ?? "", intraCommunityVat: c.intraCommunityVat ?? "", taxRegion: c.taxRegion ?? "",
      taxOffice: c.taxOffice ?? "", ntd: c.ntd ?? "", fiscalYearStartMonth: c.fiscalYearStartMonth,
    },
    social: {
      socialSecurityNumber: c.socialSecurityNumber ?? "", familyBenefitRate: num(c.familyBenefitRate),
      workAccidentRate: num(c.workAccidentRate), minimumWageSector: c.minimumWageSector ?? "",
    },
  };

  let team = null;
  if (ctx.can("users.member.read")) {
    const [members, invitations, roles, limits, usage] = await Promise.all([
      listMembers(ctx), listPendingInvitations(ctx), listRoles(ctx), getEffectiveLimits(ctx.company.id), getUsage(ctx.company.id),
    ]);
    const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
    team = (
      <MembersPanel
        currentUserId={ctx.user.id}
        isAdmin={ctx.access.isAdmin}
        can={{ invite: ctx.can("users.member.invite"), update: ctx.can("users.member.update"), remove: ctx.can("users.member.remove") }}
        usage={{ used: usage.users, max: limits.users }}
        roles={roles.map((r) => ({ id: r.id, name: r.name, isAdmin: r.isAdmin }))}
        members={members.map((m) => ({
          id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, roleId: m.roleId, roleName: m.role.name,
          roleIsAdmin: m.role.isAdmin, isOwner: m.isOwner, status: m.status, twoFactor: m.user.totpEnabledAt !== null,
          lastLogin: m.user.lastLoginAt ? dateFmt.format(m.user.lastLoginAt) : "Jamais",
        }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, roleName: i.role.name, expires: dateFmt.format(i.expiresAt) }))}
      />
    );
  }

  return <SetupWizard initial={initial} completed={c.onboardingCompletedAt !== null} team={team} />;
}
