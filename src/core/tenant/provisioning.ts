import "server-only";
import { randomBytes } from "node:crypto";
import { platformTransaction, type Db } from "@/core/db/client";
import { AppError } from "@/core/errors";
import { ALWAYS_ENABLED, MODULES } from "@/core/modules/registry";
import { PERMISSIONS, ROLE_TEMPLATES, expandPatterns } from "@/core/rbac/catalog";
import { ensureCompanyDefaults } from "./defaults";

/** Synchronise le catalogue code → base (modules + permissions). Idempotent ; appelé par le seed et au déploiement. */
export async function syncCatalog(db: Db) {
  for (const m of MODULES) {
    await db.module.upsert({
      where: { key: m.key },
      create: { key: m.key, name: m.name, description: m.description, kind: m.kind, icon: m.icon, sortOrder: m.sortOrder },
      update: { name: m.name, description: m.description, kind: m.kind, icon: m.icon, sortOrder: m.sortOrder },
    });
  }
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, moduleKey: p.module, resource: p.resource, action: p.action, label: p.label },
      update: { moduleKey: p.module, resource: p.resource, action: p.action, label: p.label },
    });
  }
  // Permissions retirées du catalogue → supprimées (cascade sur RolePermission).
  await db.permission.deleteMany({ where: { key: { notIn: PERMISSIONS.map((p) => p.key) } } });
}

export function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "entreprise"
  );
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  let slug = slugify(base);
  while (await db.company.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${slugify(base).slice(0, 40)}-${randomBytes(2).toString("hex")}`;
  }
  return slug;
}

/** Aligne les CompanyModule « hérités du plan » sur le plan courant ; les surcharges manuelles sont conservées. */
export async function applyPlanModules(db: Db, companyId: string, planId: string) {
  const [allModules, planModules, existing] = await Promise.all([
    db.module.findMany({ select: { id: true, key: true } }),
    db.planModule.findMany({ where: { planId }, select: { moduleId: true } }),
    db.companyModule.findMany({ where: { companyId } }),
  ]);
  const inPlan = new Set(planModules.map((p) => p.moduleId));
  const byModule = new Map(existing.map((e) => [e.moduleId, e]));

  for (const m of allModules) {
    const enabled = inPlan.has(m.id) || (ALWAYS_ENABLED as readonly string[]).includes(m.key);
    const row = byModule.get(m.id);
    if (!row) {
      await db.companyModule.create({ data: { companyId, moduleId: m.id, enabled, source: "PLAN" } });
    } else if (row.source === "PLAN" && row.enabled !== enabled) {
      await db.companyModule.update({ where: { id: row.id }, data: { enabled } });
    }
  }
}

export interface ProvisionCompanyInput {
  legalName: string;
  tradeName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string;
  currency?: string;
  timezone?: string;
  city?: string | null;
  address?: string | null;
  sector?: string | null;
  size?: string | null;
  rccm?: string | null;
  taxId?: string | null;
  legalForm?: string | null;
  fiscalYearStartMonth?: number;
  onboardingCompleted?: boolean;
  planCode: string;
  /** Si fourni, devient propriétaire avec le rôle Administrateur. */
  ownerUserId?: string | null;
  createdById?: string | null;
}

/**
 * Crée une entreprise complète, en une transaction : société, rôles (copiés des gabarits),
 * abonnement d'essai, modules du plan, siège, et membership propriétaire.
 */
export async function provisionCompany(input: ProvisionCompanyInput) {
  return platformTransaction(async (tx) => {
    const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.isActive) throw new AppError("NOT_FOUND", "Offre introuvable.");

    const company = await tx.company.create({
      data: {
        legalName: input.legalName,
        tradeName: input.tradeName ?? null,
        slug: await uniqueSlug(tx, input.tradeName ?? input.legalName),
        email: input.email ?? null,
        phone: input.phone ?? null,
        country: input.country ?? "CI",
        currency: input.currency ?? plan.currency,
        timezone: input.timezone ?? "Africa/Abidjan",
        city: input.city ?? null,
        address: input.address ?? null,
        sector: input.sector ?? null,
        size: input.size ?? null,
        rccm: input.rccm ?? null,
        taxId: input.taxId ?? null,
        legalForm: input.legalForm ?? null,
        fiscalYearStartMonth: input.fiscalYearStartMonth ?? 1,
        onboardingCompletedAt: input.onboardingCompleted ? new Date() : null,
        createdById: input.createdById ?? null,
      },
    });

    const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
    const permId = new Map(permissions.map((p) => [p.key, p.id]));
    let adminRoleId = "";
    for (const tpl of ROLE_TEMPLATES) {
      const role = await tx.role.create({
        data: {
          companyId: company.id,
          name: tpl.name,
          description: tpl.description,
          templateKey: tpl.key,
          isAdmin: tpl.isAdmin ?? false,
          isSystem: tpl.isAdmin ?? false, // le rôle Administrateur n'est ni supprimable ni dé-privilégiable
        },
      });
      if (tpl.isAdmin) adminRoleId = role.id;
      else {
        const ids = expandPatterns(tpl.patterns).map((k) => permId.get(k)).filter((v): v is string => Boolean(v));
        if (ids.length) {
          await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: role.id, companyId: company.id, permissionId })) });
        }
      }
    }

    const now = new Date();
    const trialEnds = new Date(now.getTime() + plan.trialDays * 86_400_000);
    await tx.subscription.create({
      data: {
        companyId: company.id,
        planId: plan.id,
        status: plan.trialDays > 0 ? "TRIALING" : "ACTIVE",
        billingCycle: "MONTHLY",
        priceAmount: plan.priceMonthly,
        currency: plan.currency,
        currentPeriodStart: now,
        currentPeriodEnd: plan.trialDays > 0 ? trialEnds : new Date(now.getTime() + 30 * 86_400_000),
        trialEndsAt: plan.trialDays > 0 ? trialEnds : null,
      },
    });
    await applyPlanModules(tx, company.id, plan.id);
    await ensureCompanyDefaults(tx, company.id, company.country);

    await tx.branch.create({
      data: { companyId: company.id, name: "Siège", code: "HQ", isHeadquarters: true, city: input.city ?? null, createdById: input.createdById ?? null },
    });

    if (input.ownerUserId) {
      await tx.companyMembership.create({
        data: { userId: input.ownerUserId, companyId: company.id, roleId: adminRoleId, isOwner: true },
      });
    }
    return { company, adminRoleId };
  });
}
