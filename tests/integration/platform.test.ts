import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import {
  changeCompanyPlan, createCompanyByPlatform, listCompanies, resetCompanyModule, setCompanyLimit, setCompanyModule, setCompanyStatus,
} from "@/modules/platform/companies";
import { updatePlan } from "@/modules/platform/plans";
import { computeRecurring, getPlatformStats } from "@/modules/platform/stats";
import { ctxFor, makeCompany, uid } from "../helpers";
import { getEffectiveLimits } from "@/core/modules/limits";

describe("Super Admin — entreprises, offres, modules", () => {
  it("crée une entreprise avec invitation d'administrateur quand l'utilisateur n'existe pas", async () => {
    const email = `admin-${uid()}@t.local`;
    const orig = console.info; let log = ""; console.info = (m: unknown) => { log += String(m); };
    let result;
    try {
      result = await createCompanyByPlatform({ legalName: `Créée ${uid()}`, planCode: "business", adminEmail: email });
    } finally { console.info = orig; }
    expect(result.adminWasExisting).toBe(false);
    expect(log).toContain("/invitation/");
    const inv = await platformDb.invitation.findFirstOrThrow({ where: { companyId: result.company.id } });
    expect(inv.email).toBe(email);
    const role = await platformDb.role.findUniqueOrThrow({ where: { id: inv.roleId } });
    expect(role.isAdmin).toBe(true);
  });

  it("rattache directement l'administrateur s'il a déjà un compte", async () => {
    const { owner } = await makeCompany("Existing");
    const res = await createCompanyByPlatform({ legalName: `Directe ${uid()}`, planCode: "starter", adminEmail: owner.email.toUpperCase() });
    expect(res.adminWasExisting).toBe(true);
    const m = await platformDb.companyMembership.findUnique({ where: { userId_companyId: { userId: owner.id, companyId: res.company.id } } });
    expect(m?.isOwner).toBe(true);
  });

  it("active/désactive un module pour UNE entreprise : effet immédiat sur son contexte, sans toucher les autres", async () => {
    const A = await makeCompany("ModA", "starter");
    const B = await makeCompany("ModB", "starter");
    expect((await ctxFor(A.owner.id, A.company.id)).hasModule("finance")).toBe(false);

    await setCompanyModule(A.company.id, "finance", true);
    expect((await ctxFor(A.owner.id, A.company.id)).hasModule("finance")).toBe(true);
    expect((await ctxFor(A.owner.id, A.company.id)).can("finance.expense.read")).toBe(true);
    expect((await ctxFor(B.owner.id, B.company.id)).hasModule("finance")).toBe(false);

    await resetCompanyModule(A.company.id, "finance"); // retour à l'offre Starter
    expect((await ctxFor(A.owner.id, A.company.id)).hasModule("finance")).toBe(false);

    await setCompanyModule(A.company.id, "sales", false);
    expect((await ctxFor(A.owner.id, A.company.id)).can("finance.invoice.read")).toBe(false);
  });

  it("le cœur ne peut pas être désactivé", async () => {
    const { company } = await makeCompany("Core");
    await expect(setCompanyModule(company.id, "core", false)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("un module désactivé globalement disparaît pour toutes les entreprises", async () => {
    const { company, owner } = await makeCompany("Global", "enterprise");
    expect((await ctxFor(owner.id, company.id)).hasModule("construction")).toBe(true);
    await platformDb.module.update({ where: { key: "construction" }, data: { isActive: false } });
    try {
      expect((await ctxFor(owner.id, company.id)).hasModule("construction")).toBe(false);
    } finally {
      await platformDb.module.update({ where: { key: "construction" }, data: { isActive: true } });
    }
  });

  it("changer d'offre met à jour prix, statut et modules ; la modification d'une offre se propage", async () => {
    const { company } = await makeCompany("Plan", "starter");
    const business = await platformDb.plan.findUniqueOrThrow({ where: { code: "business" } });
    const sub = await changeCompanyPlan(company.id, business.id, { status: "ACTIVE", billingCycle: "YEARLY" });
    expect(sub.status).toBe("ACTIVE");
    expect(Number(sub.priceAmount)).toBe(Number(business.priceYearly));
    expect((await getEffectiveLimits(company.id)).users).toBe(25);

    const planBefore = await platformDb.plan.findUniqueOrThrow({ where: { code: "starter" }, include: { modules: { include: { module: true } }, limits: true } });
    const { company: sc } = await makeCompany("StarterSub", "starter");
    const keys = planBefore.modules.map((m) => m.module.key);
    try {
      const res = await updatePlan({
        planId: planBefore.id, name: planBefore.name, description: planBefore.description, priceMonthly: 30000, priceYearly: 300000,
        trialDays: planBefore.trialDays, isPublic: true, isActive: true, moduleKeys: [...keys, "reports"], limits: { users: 7 },
      });
      expect(res.affectedCompanies).toBeGreaterThan(0);
      const enabled = (await platformDb.companyModule.findMany({ where: { companyId: sc.id, enabled: true }, include: { module: true } })).map((m) => m.module.key);
      expect(enabled).toContain("reports");
      expect((await getEffectiveLimits(sc.id)).users).toBe(7);
    } finally {
      await updatePlan({
        planId: planBefore.id, name: planBefore.name, description: planBefore.description, priceMonthly: Number(planBefore.priceMonthly), priceYearly: Number(planBefore.priceYearly),
        trialDays: planBefore.trialDays, isPublic: true, isActive: true, moduleKeys: keys, limits: { users: planBefore.limits.find((l) => l.key === "users")!.value },
      });
    }
  });

  it("surcharge et retire une limite d'usage", async () => {
    const { company } = await makeCompany("Lim2", "starter");
    await setCompanyLimit(company.id, "users", 50);
    expect((await getEffectiveLimits(company.id)).users).toBe(50);
    await setCompanyLimit(company.id, "users", null);
    expect((await getEffectiveLimits(company.id)).users).toBe(5);
    await expect(setCompanyLimit(company.id, "inconnue", 1)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("suspend et réactive ; la liste filtre par statut et recherche", async () => {
    const { company } = await makeCompany("Susp");
    await setCompanyStatus(company.id, "SUSPENDED", "impayé");
    const suspended = await listCompanies({ status: "SUSPENDED", q: company.legalName });
    expect(suspended.rows.map((r) => r.id)).toContain(company.id);
    expect((await platformDb.company.findUniqueOrThrow({ where: { id: company.id } })).suspendedReason).toBe("impayé");
    await setCompanyStatus(company.id, "ACTIVE");
    expect((await listCompanies({ status: "SUSPENDED", q: company.legalName })).rows).toHaveLength(0);
    expect((await platformDb.company.findUniqueOrThrow({ where: { id: company.id } })).suspendedReason).toBeNull();
  });
});

describe("Super Admin — statistiques", () => {
  it("MRR : annuel ÷ 12, essais et résiliés exclus", () => {
    const d = (n: number) => ({ toString: () => String(n) });
    const out = computeRecurring([
      { status: "ACTIVE", billingCycle: "MONTHLY", priceAmount: d(75000), currency: "XOF" },
      { status: "ACTIVE", billingCycle: "YEARLY", priceAmount: d(2400000), currency: "XOF" },
      { status: "TRIALING", billingCycle: "MONTHLY", priceAmount: d(999999), currency: "XOF" },
      { status: "CANCELED", billingCycle: "MONTHLY", priceAmount: d(999999), currency: "XOF" },
      { status: "PAST_DUE", billingCycle: "MONTHLY", priceAmount: d(1000), currency: "EUR" },
    ]);
    expect(out.find((o) => o.currency === "XOF")).toEqual({ currency: "XOF", mrr: 275000, arr: 3300000 });
    expect(out.find((o) => o.currency === "EUR")).toEqual({ currency: "EUR", mrr: 1000, arr: 12000 });
  });

  it("agrège les indicateurs de la plateforme", async () => {
    await platformDb.demoRequest.create({ data: { fullName: "Prospect", email: "p@t.local", companyName: "Prospect SARL" } });
    const stats = await getPlatformStats();
    expect(stats.companiesTotal).toBeGreaterThan(0);
    expect(stats.companiesActive + stats.companiesSuspended).toBe(stats.companiesTotal);
    expect(stats.demoNew).toBeGreaterThan(0);
    expect(stats.signupSeries).toHaveLength(6);
    expect(stats.topModules.length).toBeGreaterThan(0);
  });
});
