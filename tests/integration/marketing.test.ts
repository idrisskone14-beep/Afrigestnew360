import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { onboardingSchema } from "@/core/tenant/schemas";
import { provisionCompany } from "@/core/tenant/provisioning";
import { demoRequestSchema } from "@/modules/marketing/schemas";
import { getPublicPlans, recordDemoRequest } from "@/modules/platform/demo";
import { makeUser, uid } from "../helpers";

const validDemo = { fullName: "Awa Koné", email: "awa@exemple.ci", companyName: "Exemple SARL", consent: true as const };

describe("formulaire de démo : validation", () => {
  it("accepte une demande minimale", () => {
    expect(demoRequestSchema.safeParse(validDemo).success).toBe(true);
  });
  it("exige le consentement, un e-mail valide et un nom d'entreprise", () => {
    expect(demoRequestSchema.safeParse({ ...validDemo, consent: false }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...validDemo, email: "pas-un-email" }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...validDemo, companyName: "" }).success).toBe(false);
  });
  it("rejette un pays, secteur ou taille hors liste", () => {
    expect(demoRequestSchema.safeParse({ ...validDemo, country: "ZZ" }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...validDemo, sector: "Inconnu" }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...validDemo, companySize: "12" }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...validDemo, country: "CI", sector: "BTP", companySize: "11-50" }).success).toBe(true);
  });
  it("le formulaire de contact exige un message", () => {
    expect(demoRequestSchema.safeParse({ ...validDemo, source: "contact" }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...validDemo, source: "contact", message: "Bonjour, pouvez-vous me rappeler ?" }).success).toBe(true);
  });
  it("normalise l'e-mail en minuscules et refuse les sources inconnues", () => {
    const r = demoRequestSchema.parse({ ...validDemo, email: " AWA@Exemple.CI " });
    expect(r.email).toBe("awa@exemple.ci");
    expect(demoRequestSchema.safeParse({ ...validDemo, source: "autre" }).success).toBe(false);
  });
});

describe("demandes de démo : enregistrement", () => {
  it("enregistre en base, consultable par le Super Admin", async () => {
    const email = `prospect-${uid()}@exemple.ci`;
    const { id, duplicate } = await recordDemoRequest({ fullName: "Prospect", email: email.toUpperCase(), companyName: "Prospect SARL", country: "CI", sector: "BTP", message: "Besoin de gérer mes chantiers", source: "demo" });
    expect(duplicate).toBe(false);
    const row = await platformDb.demoRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ email, status: "NEW", companyName: "Prospect SARL", sector: "BTP", source: "demo" });
  });

  it("n'enregistre pas de doublon pour la même adresse sur 24 h, et conserve le nouveau message", async () => {
    const email = `dup-${uid()}@exemple.ci`;
    const first = await recordDemoRequest({ fullName: "Dup", email, companyName: "Dup SARL" });
    const second = await recordDemoRequest({ fullName: "Dup", email, companyName: "Dup SARL", message: "Relance : merci de me rappeler" });
    expect(second).toEqual({ id: first.id, duplicate: true });
    expect(await platformDb.demoRequest.count({ where: { email } })).toBe(1);
    expect((await platformDb.demoRequest.findUniqueOrThrow({ where: { id: first.id } })).notes).toContain("Relance : merci de me rappeler");
  });

  it("une demande déjà traitée n'empêche pas une nouvelle demande", async () => {
    const email = `again-${uid()}@exemple.ci`;
    const first = await recordDemoRequest({ fullName: "Again", email, companyName: "Again SARL" });
    await platformDb.demoRequest.update({ where: { id: first.id }, data: { status: "CONTACTED" } });
    const second = await recordDemoRequest({ fullName: "Again", email, companyName: "Again SARL" });
    expect(second.duplicate).toBe(false);
    expect(second.id).not.toBe(first.id);
  });
});

describe("page Tarifs : offres publiques", () => {
  it("expose les offres publiques et actives, sans le module cœur", async () => {
    const plans = await getPublicPlans();
    expect(plans.map((p) => p.code)).toEqual(expect.arrayContaining(["starter", "business", "enterprise"]));
    for (const p of plans) {
      expect(p.modules.some((m) => m.key === "core")).toBe(false);
      expect(p.priceMonthly).toBeGreaterThan(0);
    }
    const starter = plans.find((p) => p.code === "starter")!;
    expect(starter.modules.map((m) => m.key)).not.toContain("finance");
    expect(starter.limits.users).toBe(5);
  });

  it("masque une offre non publique ou inactive", async () => {
    const starter = await platformDb.plan.findUniqueOrThrow({ where: { code: "starter" } });
    await platformDb.plan.update({ where: { id: starter.id }, data: { isPublic: false } });
    try {
      expect((await getPublicPlans()).map((p) => p.code)).not.toContain("starter");
    } finally {
      await platformDb.plan.update({ where: { id: starter.id }, data: { isPublic: true } });
    }
  });
});

describe("onboarding : données de l'entreprise", () => {
  const valid = { fullName: "Idrissa Koné", legalName: "Ma Société SARL", currency: "XOF", country: "CI", fiscalYearStartMonth: 1 };

  it("valide les 10 étapes et refuse les valeurs hors liste", () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...valid, currency: "BTC" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, country: "XX" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, fiscalYearStartMonth: 13 }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, email: "x" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, legalName: "A" }).success).toBe(false);
  });

  it("crée l'entreprise avec toutes les informations légales, l'exercice et l'onboarding terminé", async () => {
    const user = await makeUser();
    const { company } = await provisionCompany({
      legalName: `Complète ${uid()}`, tradeName: "Complète", email: "contact@complete.ci", phone: "+225 01 02 03 04", legalForm: "SARL",
      rccm: "CI-ABJ-2026-B-1", taxId: "2600001 A", sector: "BTP", size: "11-50", country: "CI", currency: "XOF", timezone: "Africa/Abidjan",
      address: "Cocody", city: "Abidjan", fiscalYearStartMonth: 4, onboardingCompleted: true, planCode: "starter", ownerUserId: user.id,
    });
    const c = await platformDb.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(c).toMatchObject({ legalForm: "SARL", rccm: "CI-ABJ-2026-B-1", taxId: "2600001 A", fiscalYearStartMonth: 4, city: "Abidjan" });
    expect(c.onboardingCompletedAt).not.toBeNull();
    expect(await platformDb.companyMembership.count({ where: { companyId: company.id, userId: user.id, isOwner: true } })).toBe(1);
  });
});
