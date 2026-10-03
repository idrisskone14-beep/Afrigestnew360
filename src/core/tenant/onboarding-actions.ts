"use server";

import { defineUserAction } from "@/core/actions/define";
import { auditPlatform } from "@/core/audit";
import { platformDb } from "@/core/db/client";
import { COUNTRIES } from "@/lib/reference-data";
import { setActiveCompanyCookie } from "./cookies";
import { provisionCompany } from "./provisioning";
import { onboardingSchema } from "./schemas";

const clean = (v?: string) => (v && v.trim() ? v.trim() : null);

/**
 * Onboarding complet : met à jour le profil, crée l'entreprise (rôles, offre d'essai Starter, modules,
 * siège) et en fait l'utilisateur propriétaire/administrateur.
 */
export const createCompanyAction = defineUserAction({
  input: onboardingSchema,
  handler: async ({ session, input }) => {
    const country = COUNTRIES.find((c) => c.code === input.country)!;

    await platformDb.user.update({
      where: { id: session.user.id },
      data: { name: input.fullName.trim(), phone: clean(input.phone) },
    });

    const { company } = await provisionCompany({
      legalName: input.legalName,
      tradeName: clean(input.tradeName),
      email: clean(input.email),
      phone: clean(input.companyPhone),
      legalForm: clean(input.legalForm),
      rccm: clean(input.rccm),
      taxId: clean(input.taxId),
      sector: clean(input.sector),
      size: clean(input.size),
      country: input.country,
      currency: input.currency,
      timezone: country.timezone,
      address: clean(input.address),
      city: clean(input.city),
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      onboardingCompleted: true,
      planCode: "starter",
      ownerUserId: session.user.id,
      createdById: session.user.id,
    });

    await auditPlatform(session.user, {
      companyId: company.id,
      action: "company.create",
      resource: "Company",
      resourceId: company.id,
      summary: `${input.fullName.trim()} a créé l'entreprise ${company.legalName}.`,
    });
    await setActiveCompanyCookie(company.id);
    return { companyId: company.id };
  },
});
