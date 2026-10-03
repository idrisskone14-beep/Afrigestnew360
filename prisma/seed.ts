/**
 * Seed : catalogue (modules, permissions, offres), propriétaire de la plateforme et entreprises de démonstration.
 * Idempotent. Lancer : npm run db:seed
 * Les données métier de démonstration (clients, factures, stocks…) sont ajoutées par les phases suivantes.
 */
import "dotenv/config";
import { baseClient, platformDb, platformTransaction } from "@/core/db/client";
import { hashPassword } from "@/core/auth/password";
import { MODULES, LIMIT_KEYS, UNLIMITED } from "@/core/modules/registry";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { provisionCompany, syncCatalog } from "@/core/tenant/provisioning";
import { generateAlerts } from "@/modules/platform/alerts";
import { seedBusinessDemo, seedFinanceDemo, seedPurchasingDemo } from "./seed-demo";
import { seedFleetDemo, seedConstructionDemo } from "./seed-extensions";
import { seedPeopleDemo, seedWorkflowDemo } from "./seed-people";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo#Afrigest2026";

const PLANS = [
  {
    code: "starter", name: "Starter", description: "Pour démarrer : ventes, clients et stock.", priceMonthly: 25000, priceYearly: 250000, trialDays: 14, sortOrder: 1,
    modules: ["core", "crm", "sales", "inventory", "documents"],
    limits: { users: 5, employees: 10, products: 500, customers: 500, projects: 10, vehicles: 0, storage_mb: 1024, documents: 1000 },
  },
  {
    code: "business", name: "Business", description: "Gestion complète : finance, achats, RH, projets.", priceMonthly: 75000, priceYearly: 750000, trialDays: 14, sortOrder: 2,
    modules: ["core", "finance", "accounting", "sales", "crm", "purchases", "inventory", "hr", "payroll", "projects", "documents", "reports"],
    limits: { users: 25, employees: 100, products: 5000, customers: 5000, projects: 100, vehicles: 10, storage_mb: 10240, documents: 20000 },
  },
  {
    code: "enterprise", name: "Enterprise", description: "Tous les modules et extensions, limites étendues.", priceMonthly: 200000, priceYearly: 2000000, trialDays: 30, sortOrder: 3,
    modules: MODULES.map((m) => m.key as string),
    limits: { users: UNLIMITED, employees: UNLIMITED, products: UNLIMITED, customers: UNLIMITED, projects: UNLIMITED, vehicles: UNLIMITED, storage_mb: 102400, documents: UNLIMITED },
  },
] as const;

async function seedPlans() {
  const modules = await platformDb.module.findMany();
  const idByKey = new Map(modules.map((m) => [m.key, m.id]));
  for (const p of PLANS) {
    const plan = await platformDb.plan.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, description: p.description, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, trialDays: p.trialDays, sortOrder: p.sortOrder },
      update: { name: p.name, description: p.description, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, trialDays: p.trialDays, sortOrder: p.sortOrder },
    });
    await platformDb.planModule.deleteMany({ where: { planId: plan.id } });
    await platformDb.planModule.createMany({
      data: p.modules.map((k) => ({ planId: plan.id, moduleId: idByKey.get(k)! })),
    });
    for (const { key } of LIMIT_KEYS) {
      const value = (p.limits as Record<string, number>)[key] ?? UNLIMITED;
      await platformDb.planLimit.upsert({
        where: { planId_key: { planId: plan.id, key } },
        create: { planId: plan.id, key, value },
        update: { value },
      });
    }
  }
}

async function upsertUser(email: string, name: string, password: string, extra: { isPlatformAdmin?: boolean } = {}) {
  const existing = await platformDb.user.findUnique({ where: { email } });
  if (existing) return existing;
  return platformDb.user.create({
    data: { email, name, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), ...extra },
  });
}

async function roleId(companyId: string, templateKey: string) {
  const r = await platformDb.role.findFirstOrThrow({ where: { companyId, templateKey } });
  return r.id;
}

async function seedDemo() {
  const idrissa = await upsertUser("idrissa@afrigest360.demo", "Idrissa Koné", DEMO_PASSWORD);
  const awa = await upsertUser("awa.comptable@afrigest360.demo", "Awa Traoré", DEMO_PASSWORD);
  const moussa = await upsertUser("moussa.commercial@afrigest360.demo", "Moussa Diallo", DEMO_PASSWORD);

  // Entreprise A — démonstration principale (offre Enterprise : tous les modules)
  let a = await platformDb.company.findFirst({ where: { legalName: "AFRICA BUSINESS DEMO SARL" } });
  if (!a) {
    const res = await provisionCompany({
      legalName: "AFRICA BUSINESS DEMO SARL", tradeName: "Africa Business Demo", email: "contact@africabusinessdemo.ci",
      phone: "+225 27 20 00 00 00", country: "CI", city: "Abidjan", address: "Cocody, Riviera Palmeraie", currency: "XOF",
      sector: "Commerce & distribution", size: "11-50", rccm: "CI-ABJ-2021-B-12345", taxId: "2112345 A",
      planCode: "enterprise", ownerUserId: idrissa.id,
    });
    a = res.company;
    await platformDb.subscription.update({ where: { companyId: a.id }, data: { status: "ACTIVE", trialEndsAt: null } });
    await platformDb.companyMembership.createMany({
      data: [
        { userId: awa.id, companyId: a.id, roleId: await roleId(a.id, "accountant") },
        { userId: moussa.id, companyId: a.id, roleId: await roleId(a.id, "sales_rep") },
      ],
    });
  }

  // Entreprise B — Idrissa y est Responsable Commercial (démo multi-entreprises, offre Business : sans extensions)
  let b = await platformDb.company.findFirst({ where: { legalName: "SAHEL TRANSPORT & LOGISTIQUE SA" } });
  if (!b) {
    const owner = await upsertUser("direction@sahel-transport.demo", "Fatoumata Ouédraogo", DEMO_PASSWORD);
    const res = await provisionCompany({
      legalName: "SAHEL TRANSPORT & LOGISTIQUE SA", tradeName: "Sahel Transport", country: "BF", city: "Ouagadougou", currency: "XOF",
      sector: "Transport & logistique", size: "51-200", planCode: "business", ownerUserId: owner.id,
    });
    b = res.company;
    await platformDb.subscription.update({ where: { companyId: b.id }, data: { status: "ACTIVE", trialEndsAt: null } });
    await platformDb.companyMembership.create({
      data: { userId: idrissa.id, companyId: b.id, roleId: await roleId(b.id, "sales_manager") },
    });
  }

  // Entreprise C — Idrissa en consultation uniquement, offre Starter (modules limités)
  let c = await platformDb.company.findFirst({ where: { legalName: "BATIMAT CONSTRUCTION SARL" } });
  if (!c) {
    const owner = await upsertUser("direction@batimat.demo", "Kofi Mensah", DEMO_PASSWORD);
    const res = await provisionCompany({
      legalName: "BATIMAT CONSTRUCTION SARL", tradeName: "Batimat", country: "GH", city: "Accra", currency: "GHS",
      sector: "BTP", size: "11-50", planCode: "starter", ownerUserId: owner.id,
    });
    c = res.company;
    await platformDb.companyMembership.create({
      data: { userId: idrissa.id, companyId: c.id, roleId: await roleId(c.id, "viewer") },
    });
  }
}

async function main() {
  await syncCatalog(platformDb);
  await seedPlans();

  const ownerEmail = process.env.PLATFORM_OWNER_EMAIL;
  const ownerPassword = process.env.PLATFORM_OWNER_PASSWORD;
  if (ownerEmail && ownerPassword) {
    await upsertUser(ownerEmail.toLowerCase(), "Propriétaire AfriGest", ownerPassword, { isPlatformAdmin: true });
    await platformDb.user.update({ where: { email: ownerEmail.toLowerCase() }, data: { isPlatformAdmin: true } });
  } else {
    console.warn("PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD non définis : aucun propriétaire de plateforme créé.");
  }

  if (process.env.SEED_DEMO !== "false") await seedDemo();

  // Valeurs par défaut des entreprises existantes (taxes, pipeline…) — idempotent
  for (const c of await platformDb.company.findMany({ where: { deletedAt: null }, select: { id: true, country: true } })) {
    await platformTransaction((tx) => ensureCompanyDefaults(tx, c.id, c.country));
  }

  if (process.env.SEED_DEMO !== "false") {
    const demo = await platformDb.company.findFirst({ where: { legalName: "AFRICA BUSINESS DEMO SARL" } });
    const owner = await platformDb.user.findUnique({ where: { email: "idrissa@afrigest360.demo" } });
    if (demo && owner) {
      console.log("Données métier de démonstration…");
      await seedBusinessDemo(demo.id, owner.id);
      const requester = await platformDb.user.findUnique({ where: { email: "moussa.commercial@afrigest360.demo" } });
      if (requester) {
        await seedPurchasingDemo(demo.id, owner.id, requester.id);
        await seedFinanceDemo(demo.id, owner.id, requester.id);
        // Salariée de démonstration avec un compte « Employé » (self-service : congés, tâches, bulletins)
        const aminata = await upsertUser("aminata.employee@afrigest360.demo", "Aminata Ouattara", DEMO_PASSWORD);
        if (!(await platformDb.companyMembership.findUnique({ where: { userId_companyId: { userId: aminata.id, companyId: demo.id } } }))) {
          await platformDb.companyMembership.create({ data: { userId: aminata.id, companyId: demo.id, roleId: await roleId(demo.id, "employee") } });
        }
        const accountant = await platformDb.user.findUnique({ where: { email: "awa.comptable@afrigest360.demo" } });
        await seedPeopleDemo(demo.id, owner.id, { accountant: accountant?.id, requester: requester.id, employee: aminata.id });
        await seedWorkflowDemo(demo.id, owner.id);
        await seedFleetDemo(demo.id, owner.id);
        await seedConstructionDemo(demo.id, owner.id);
      }
      const alerts = await generateAlerts(demo.id);
      console.log(`  • ${alerts.created} alerte(s) de démonstration générée(s)`);
    }
  }
  console.log("Seed terminé.");
}

main()
  .then(() => baseClient.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await baseClient.$disconnect();
    process.exit(1);
  });
