"use server";

import { revalidatePath } from "next/cache";
import { definePlatformAction } from "@/core/actions/define";
import { auditPlatform } from "@/core/audit";
import { platformDb } from "@/core/db/client";
import { AppError, notFound } from "@/core/errors";
import { COUNTRIES } from "@/lib/reference-data";
import {
  changeCompanyPlan, createCompanyByPlatform, resetCompanyModule, setCompanyLimit, setCompanyModule, setCompanyStatus,
  updateCompanyIdentity,
} from "./companies";
import { updatePlan } from "./plans";
import {
  changePlanSchema, companyLimitSchema, companyIdSchema, companyModuleSchema, platformCreateCompanySchema,
  platformUpdateCompanySchema, resetModuleSchema, suspendCompanySchema, toggleModuleSchema, updateDemoRequestSchema, updatePlanSchema,
} from "./schemas";

const name = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;
const company = async (id: string) => {
  const c = await platformDb.company.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw notFound("Entreprise");
  return c;
};

export const createCompanyAction = definePlatformAction({
  input: platformCreateCompanySchema,
  handler: async ({ session, input }) => {
    const tz = COUNTRIES.find((c) => c.code === input.country)?.timezone;
    const { company: c, adminWasExisting } = await createCompanyByPlatform({
      legalName: input.legalName, tradeName: input.tradeName || null, country: input.country, currency: input.currency,
      timezone: tz, planCode: input.planCode, adminEmail: input.adminEmail, createdById: session.user.id,
    });
    await auditPlatform(session.user, {
      companyId: c.id, action: "company.create", resource: "Company", resourceId: c.id,
      summary: `${session.user.name} a créé l'entreprise ${c.legalName} (offre ${input.planCode}).`,
      after: { legalName: c.legalName, planCode: input.planCode, admin: input.adminEmail },
    });
    revalidatePath("/super-admin", "layout");
    return { id: c.id, adminWasExisting };
  },
});

export const updateCompanyAction = definePlatformAction({
  input: platformUpdateCompanySchema,
  handler: async ({ session, input }) => {
    const before = await company(input.companyId);
    const after = await updateCompanyIdentity(input.companyId, {
      legalName: input.legalName, tradeName: input.tradeName || null, email: input.email || null, phone: input.phone || null,
      country: input.country, currency: input.currency,
    });
    await auditPlatform(session.user, { companyId: before.id, action: "company.update", resource: "Company", resourceId: before.id, summary: `${session.user.name} a modifié l'entreprise ${name(before)}.`, before, after });
    revalidatePath("/super-admin", "layout");
  },
});

export const suspendCompanyAction = definePlatformAction({
  input: suspendCompanySchema,
  handler: async ({ session, input }) => {
    const c = await company(input.companyId);
    await setCompanyStatus(c.id, "SUSPENDED", input.reason);
    await auditPlatform(session.user, { companyId: c.id, action: "company.suspend", resource: "Company", resourceId: c.id, summary: `${session.user.name} a suspendu l'entreprise ${name(c)}.`, after: { reason: input.reason ?? null } });
    revalidatePath("/super-admin", "layout");
  },
});

export const reactivateCompanyAction = definePlatformAction({
  input: companyIdSchema,
  handler: async ({ session, input }) => {
    const c = await company(input.companyId);
    await setCompanyStatus(c.id, "ACTIVE");
    await auditPlatform(session.user, { companyId: c.id, action: "company.reactivate", resource: "Company", resourceId: c.id, summary: `${session.user.name} a réactivé l'entreprise ${name(c)}.` });
    revalidatePath("/super-admin", "layout");
  },
});

export const changePlanAction = definePlatformAction({
  input: changePlanSchema,
  handler: async ({ session, input }) => {
    const c = await company(input.companyId);
    const sub = await changeCompanyPlan(c.id, input.planId, { status: input.status, billingCycle: input.billingCycle });
    await auditPlatform(session.user, { companyId: c.id, action: "subscription.update", resource: "Subscription", resourceId: sub.id, summary: `${session.user.name} a modifié l'abonnement de ${name(c)}.`, after: { planId: input.planId, status: sub.status, billingCycle: sub.billingCycle } });
    revalidatePath("/super-admin", "layout");
  },
});

export const setCompanyModuleAction = definePlatformAction({
  input: companyModuleSchema,
  handler: async ({ session, input }) => {
    const c = await company(input.companyId);
    await setCompanyModule(c.id, input.moduleKey, input.enabled);
    await auditPlatform(session.user, { companyId: c.id, action: "module.override", resource: "CompanyModule", resourceId: input.moduleKey, summary: `${session.user.name} a ${input.enabled ? "activé" : "désactivé"} le module « ${input.moduleKey} » pour ${name(c)}.`, after: { enabled: input.enabled } });
    revalidatePath("/super-admin", "layout");
  },
});

export const resetCompanyModuleAction = definePlatformAction({
  input: resetModuleSchema,
  handler: async ({ session, input }) => {
    const c = await company(input.companyId);
    await resetCompanyModule(c.id, input.moduleKey);
    await auditPlatform(session.user, { companyId: c.id, action: "module.reset", resource: "CompanyModule", resourceId: input.moduleKey, summary: `${session.user.name} a rétabli le module « ${input.moduleKey} » selon l'offre de ${name(c)}.` });
    revalidatePath("/super-admin", "layout");
  },
});

export const setCompanyLimitAction = definePlatformAction({
  input: companyLimitSchema,
  handler: async ({ session, input }) => {
    const c = await company(input.companyId);
    await setCompanyLimit(c.id, input.key, input.value);
    await auditPlatform(session.user, { companyId: c.id, action: "limit.update", resource: "UsageLimit", resourceId: input.key, summary: `${session.user.name} a ${input.value === null ? "retiré la surcharge de" : "défini"} la limite « ${input.key} » pour ${name(c)}.`, after: { value: input.value } });
    revalidatePath("/super-admin", "layout");
  },
});

export const updatePlanAction = definePlatformAction({
  input: updatePlanSchema,
  handler: async ({ session, input }) => {
    const res = await updatePlan({ ...input, description: input.description ?? null });
    await auditPlatform(session.user, { action: "plan.update", resource: "Plan", resourceId: input.planId, summary: `${session.user.name} a modifié l'offre « ${input.name} » (${res.affectedCompanies} entreprise(s) mises à jour).`, after: input });
    revalidatePath("/super-admin", "layout");
    return res;
  },
});

export const toggleModuleAction = definePlatformAction({
  input: toggleModuleSchema,
  handler: async ({ session, input }) => {
    const m = await platformDb.module.findUnique({ where: { key: input.moduleKey } });
    if (!m) throw notFound("Module");
    if (m.kind === "CORE") throw new AppError("BUSINESS_RULE", "Le cœur ne peut pas être désactivé.");
    await platformDb.module.update({ where: { id: m.id }, data: { isActive: input.isActive } });
    await auditPlatform(session.user, { action: "module.global_toggle", resource: "Module", resourceId: m.key, summary: `${session.user.name} a ${input.isActive ? "réactivé" : "désactivé globalement"} le module « ${m.name} ».` });
    revalidatePath("/super-admin", "layout");
  },
});

export const updateDemoRequestAction = definePlatformAction({
  input: updateDemoRequestSchema,
  handler: async ({ session, input }) => {
    await platformDb.demoRequest.update({ where: { id: input.id }, data: { status: input.status, notes: input.notes ?? null, handledById: session.user.id } });
    revalidatePath("/super-admin", "layout");
  },
});
