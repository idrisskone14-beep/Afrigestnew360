import "server-only";
import { generateToken } from "@/core/auth/crypto";
import { normalizeEmail } from "@/core/auth/login";
import { platformDb, platformTransaction } from "@/core/db/client";
import { AppError, businessRule, notFound } from "@/core/errors";
import { appUrl, sendMail } from "@/core/mail";
import { LIMIT_KEYS, MODULES } from "@/core/modules/registry";
import { getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { applyPlanModules, provisionCompany, type ProvisionCompanyInput } from "@/core/tenant/provisioning";

export const PAGE_SIZE = 15;

export async function listCompanies(params: { q?: string; status?: "ACTIVE" | "SUSPENDED"; page?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const where = {
    deletedAt: null,
    ...(params.status ? { status: params.status } : {}),
    ...(params.q
      ? { OR: [{ legalName: { contains: params.q, mode: "insensitive" as const } }, { tradeName: { contains: params.q, mode: "insensitive" as const } }, { slug: { contains: params.q, mode: "insensitive" as const } }, { email: { contains: params.q, mode: "insensitive" as const } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    platformDb.company.count({ where }),
    platformDb.company.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      include: { subscription: { select: { status: true, plan: { select: { name: true } } } }, _count: { select: { memberships: true } } },
    }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows };
}

export async function getCompanyDetail(id: string) {
  const company = await platformDb.company.findFirst({
    where: { id, deletedAt: null },
    include: { subscription: { include: { plan: true } } },
  });
  if (!company) throw notFound("Entreprise");

  const [modules, overrides, members, activity, limits, usage, plans, invitations] = await Promise.all([
    platformDb.companyModule.findMany({ where: { companyId: id }, include: { module: true } }),
    platformDb.usageLimit.findMany({ where: { companyId: id } }),
    platformDb.companyMembership.findMany({
      where: { companyId: id }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
      include: { user: { select: { name: true, email: true, lastLoginAt: true } }, role: { select: { name: true } } },
    }),
    platformDb.auditLog.findMany({ where: { companyId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    getEffectiveLimits(id),
    getUsage(id),
    platformDb.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    platformDb.invitation.findMany({ where: { companyId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, include: { role: { select: { name: true } } } }),
  ]);
  return { company, modules, overrides, members, activity, limits, usage, plans, invitations };
}

/** Invite l'administrateur initial (invitation avec le rôle Administrateur) depuis la plateforme. */
export async function inviteCompanyAdmin(companyId: string, email: string, invitedById: string | null, companyName: string) {
  const adminRole = await platformDb.role.findFirst({ where: { companyId, isAdmin: true } });
  if (!adminRole) throw businessRule("Rôle administrateur introuvable.");
  const clean = normalizeEmail(email);
  await platformDb.invitation.updateMany({ where: { companyId, email: clean, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const { token, hash } = generateToken();
  const inv = await platformDb.invitation.create({
    data: { companyId, email: clean, roleId: adminRole.id, tokenHash: hash, invitedById, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
  });
  await sendMail({
    to: clean,
    subject: `Votre espace ${companyName} est prêt sur AfriGest 360`,
    text: `Vous avez été désigné(e) administrateur de « ${companyName} » sur AfriGest 360.\n\nActivez votre accès :\n${appUrl(`/invitation/${token}`)}\n\nCe lien est valable 7 jours.`,
  });
  return inv;
}

export async function createCompanyByPlatform(
  input: Omit<ProvisionCompanyInput, "ownerUserId"> & { adminEmail: string },
) {
  const { adminEmail: rawEmail, ...rest } = input;
  const adminEmail = normalizeEmail(rawEmail);
  const existing = await platformDb.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  const { company } = await provisionCompany({ ...rest, ownerUserId: existing?.id ?? null });
  if (!existing) await inviteCompanyAdmin(company.id, adminEmail, input.createdById ?? null, company.tradeName ?? company.legalName);
  return { company, adminWasExisting: Boolean(existing) };
}

export async function setCompanyStatus(id: string, status: "ACTIVE" | "SUSPENDED", reason?: string) {
  const company = await platformDb.company.findFirst({ where: { id, deletedAt: null } });
  if (!company) throw notFound("Entreprise");
  return platformDb.company.update({
    where: { id },
    data: status === "SUSPENDED" ? { status, suspendedAt: new Date(), suspendedReason: reason ?? null } : { status, suspendedAt: null, suspendedReason: null },
  });
}

export async function changeCompanyPlan(id: string, planId: string, options: { status?: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED"; billingCycle?: "MONTHLY" | "YEARLY" }) {
  const plan = await platformDb.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("Offre");
  return platformTransaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { companyId: id } });
    if (!sub) throw notFound("Abonnement");
    const cycle = options.billingCycle ?? sub.billingCycle;
    const updated = await tx.subscription.update({
      where: { companyId: id },
      data: {
        planId: plan.id,
        billingCycle: cycle,
        status: options.status ?? sub.status,
        priceAmount: cycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly,
        currency: plan.currency,
        canceledAt: (options.status ?? sub.status) === "CANCELED" ? new Date() : null,
      },
    });
    await applyPlanModules(tx, id, plan.id);
    return updated;
  });
}

export async function setCompanyModule(companyId: string, moduleKey: string, enabled: boolean) {
  const mod = MODULES.find((m) => m.key === moduleKey);
  if (!mod) throw notFound("Module");
  if (mod.kind === "CORE") throw businessRule("Le cœur est toujours actif.");
  const m = await platformDb.module.findUniqueOrThrow({ where: { key: moduleKey } });
  await platformDb.companyModule.upsert({
    where: { companyId_moduleId: { companyId, moduleId: m.id } },
    create: { companyId, moduleId: m.id, enabled, source: "OVERRIDE" },
    update: { enabled, source: "OVERRIDE" },
  });
}

/** Remet un module à l'état défini par l'offre (supprime la surcharge). */
export async function resetCompanyModule(companyId: string, moduleKey: string) {
  const sub = await platformDb.subscription.findUnique({ where: { companyId } });
  if (!sub) throw notFound("Abonnement");
  const m = await platformDb.module.findUniqueOrThrow({ where: { key: moduleKey } });
  const inPlan = await platformDb.planModule.findUnique({ where: { planId_moduleId: { planId: sub.planId, moduleId: m.id } } });
  await platformDb.companyModule.upsert({
    where: { companyId_moduleId: { companyId, moduleId: m.id } },
    create: { companyId, moduleId: m.id, enabled: Boolean(inPlan), source: "PLAN" },
    update: { enabled: Boolean(inPlan), source: "PLAN" },
  });
}

export async function setCompanyLimit(companyId: string, key: string, value: number | null) {
  if (!LIMIT_KEYS.some((l) => l.key === key)) throw new AppError("VALIDATION", "Limite inconnue.");
  if (value === null) {
    await platformDb.usageLimit.deleteMany({ where: { companyId, key } });
    return;
  }
  await platformDb.usageLimit.upsert({
    where: { companyId_key: { companyId, key } },
    create: { companyId, key, value },
    update: { value },
  });
}

export async function updateCompanyIdentity(id: string, data: { legalName: string; tradeName?: string | null; email?: string | null; phone?: string | null; country: string; currency: string }) {
  return platformDb.company.update({ where: { id }, data });
}
