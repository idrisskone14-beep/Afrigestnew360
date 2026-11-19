import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { setupFiscalSchema, setupIdentificationSchema, setupSocialSchema } from "@/core/tenant/setup-schemas";
import { completeSetup, saveSetupFiscal, saveSetupIdentification, saveSetupSocial, skipSetup } from "@/modules/settings/setup";
import { ctxFor, makeCompany } from "../helpers";

const company = (id: string) => platformDb.company.findUniqueOrThrow({ where: { id } });

describe("parcours de paramétrage du dossier de l'entreprise", () => {
  it("enregistre identification, dossier fiscal et dossier social, et laisse les champs vides à NULL", async () => {
    const { company: c, owner } = await makeCompany("SETUP", "business");
    const ctx = await ctxFor(owner.id, c.id);

    await saveSetupIdentification(ctx, setupIdentificationSchema.parse({
      legalName: "ETS GLOBAL TRANSPORT", tradeName: "", acronym: "EGT", legalForm: "Société à Responsabilité Limitée (SARL)",
      shareCapital: "20000000", sector: "Transport & logistique", activityDescription: "Transports routiers de marchandises",
      accountingFramework: "SYSCOHADA révisé", rccm: "", country: "CI", address: "Yopougon, Cité Bel Air", commune: "Yopougon",
      city: "ABIDJAN", postalCode: "", email: "contact@egt.test", phone: "0506171819",
    }));
    await saveSetupFiscal(ctx, setupFiscalSchema.parse({
      taxId: "1507399G", taxRegime: "Réel normal", activityStartDate: "2016-04-05", vatFrequency: "Mensuelle", vatRof: "",
      intraCommunityVat: "", taxRegion: "", taxOffice: "DEUX PLATEAUX DJIBI", ntd: "", fiscalYearStartMonth: "1",
    }));
    await saveSetupSocial(ctx, setupSocialSchema.parse({ socialSecurityNumber: "CNPS-123", familyBenefitRate: "5.75", workAccidentRate: "2", minimumWageSector: "" }));

    const r = await company(c.id);
    expect(r).toMatchObject({
      legalName: "ETS GLOBAL TRANSPORT", acronym: "EGT", commune: "Yopougon", city: "ABIDJAN", accountingFramework: "SYSCOHADA révisé",
      taxId: "1507399G", taxRegime: "Réel normal", vatFrequency: "Mensuelle", taxOffice: "DEUX PLATEAUX DJIBI", socialSecurityNumber: "CNPS-123",
    });
    expect(Number(r.shareCapital)).toBe(20000000);
    expect(Number(r.familyBenefitRate)).toBe(5.75);
    expect(Number(r.workAccidentRate)).toBe(2);
    expect(r.activityStartDate?.toISOString().slice(0, 10)).toBe("2016-04-05");
    expect(r.tradeName).toBeNull();
    expect(r.rccm).toBeNull();
    expect(r.postalCode).toBeNull();
    expect(r.minimumWageSector).toBeNull();
  });

  it("« passer » mémorise le choix sans terminer ; « terminer » ferme le rappel, une seule fois", async () => {
    const { company: c, owner } = await makeCompany("SETUP2", "business");
    const ctx = await ctxFor(owner.id, c.id);
    const before = await company(c.id);
    expect(before.onboardingCompletedAt).toBeNull();
    expect(before.setupSkippedAt).toBeNull();

    await skipSetup(ctx);
    const skipped = await company(c.id);
    expect(skipped.setupSkippedAt).not.toBeNull();
    expect(skipped.onboardingCompletedAt).toBeNull();

    await completeSetup(ctx);
    const done = await company(c.id);
    expect(done.onboardingCompletedAt).not.toBeNull();
    await completeSetup(ctx); // idempotent : la date de fin ne bouge plus
    expect((await company(c.id)).onboardingCompletedAt?.getTime()).toBe(done.onboardingCompletedAt?.getTime());
  });

  it("n'écrit que dans l'entreprise du contexte", async () => {
    const A = await makeCompany("SETUPA", "business");
    const B = await makeCompany("SETUPB", "business");
    const ctxA = await ctxFor(A.owner.id, A.company.id);
    await saveSetupSocial(ctxA, setupSocialSchema.parse({ socialSecurityNumber: "ONLY-A", familyBenefitRate: "", workAccidentRate: "", minimumWageSector: "" }));
    expect((await company(A.company.id)).socialSecurityNumber).toBe("ONLY-A");
    expect((await company(B.company.id)).socialSecurityNumber).toBeNull();
  });

  it("refuse les valeurs invalides (taux hors 0-100, date mal formée, e-mail, raison sociale vide)", () => {
    expect(setupSocialSchema.safeParse({ familyBenefitRate: "150" }).success).toBe(false);
    expect(setupSocialSchema.safeParse({ workAccidentRate: "-1" }).success).toBe(false);
    expect(setupFiscalSchema.safeParse({ activityStartDate: "05/04/2016", fiscalYearStartMonth: 1 }).success).toBe(false);
    expect(setupFiscalSchema.safeParse({ activityStartDate: "2016-04-05", fiscalYearStartMonth: 13 }).success).toBe(false);
    expect(setupIdentificationSchema.safeParse({ legalName: "", country: "CI" }).success).toBe(false);
    expect(setupIdentificationSchema.safeParse({ legalName: "ACME", country: "CI", email: "pas-un-mail" }).success).toBe(false);
    expect(setupIdentificationSchema.safeParse({ legalName: "ACME", country: "ZZ" }).success).toBe(false);
  });
});
