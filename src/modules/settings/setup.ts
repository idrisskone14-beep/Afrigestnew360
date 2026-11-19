import { audit } from "@/core/audit";
import { d } from "@/core/money";
import type { TenantContext } from "@/core/tenant/ctx-factory";
import type { SetupFiscal, SetupIdentification, SetupSocial } from "@/core/tenant/setup-schemas";

/** Parcours de paramétrage du dossier de l'entreprise (voir core/tenant/setup-schemas.ts). Droit requis : settings.company.update. */
type Ctx = Pick<TenantContext, "db" | "company" | "user">;

const clean = (v?: string) => (v && v.trim().length > 0 ? v.trim() : null);
const money = (v: string | number | undefined) => (v === undefined || v === "" ? null : d(v).toString());

async function save(ctx: Ctx, section: string, data: Record<string, unknown>) {
  const before = await ctx.db.company.findFirstOrThrow({ where: { id: ctx.company.id } });
  const after = await ctx.db.company.update({ where: { id: ctx.company.id }, data });
  await audit(ctx as TenantContext, {
    action: "company.setup", resource: "Company", resourceId: ctx.company.id,
    summary: `${ctx.user.name} a renseigné le dossier de l'entreprise (${section}).`,
    before, after,
  });
  return after;
}

export function saveSetupIdentification(ctx: Ctx, i: SetupIdentification) {
  return save(ctx, "identification", {
    legalName: i.legalName,
    tradeName: clean(i.tradeName),
    acronym: clean(i.acronym),
    legalForm: clean(i.legalForm),
    shareCapital: money(i.shareCapital),
    sector: clean(i.sector),
    activityDescription: clean(i.activityDescription),
    accountingFramework: clean(i.accountingFramework),
    rccm: clean(i.rccm),
    country: i.country,
    address: clean(i.address),
    commune: clean(i.commune),
    city: clean(i.city),
    postalCode: clean(i.postalCode),
    email: clean(i.email),
    phone: clean(i.phone),
  });
}

export function saveSetupFiscal(ctx: Ctx, i: SetupFiscal) {
  return save(ctx, "dossier fiscal", {
    taxId: clean(i.taxId),
    taxRegime: clean(i.taxRegime),
    activityStartDate: i.activityStartDate ? new Date(`${i.activityStartDate}T00:00:00.000Z`) : null,
    vatFrequency: clean(i.vatFrequency),
    vatRof: clean(i.vatRof),
    intraCommunityVat: clean(i.intraCommunityVat),
    taxRegion: clean(i.taxRegion),
    taxOffice: clean(i.taxOffice),
    ntd: clean(i.ntd),
    fiscalYearStartMonth: i.fiscalYearStartMonth,
  });
}

export function saveSetupSocial(ctx: Ctx, i: SetupSocial) {
  return save(ctx, "dossier social", {
    socialSecurityNumber: clean(i.socialSecurityNumber),
    familyBenefitRate: money(i.familyBenefitRate),
    workAccidentRate: money(i.workAccidentRate),
    minimumWageSector: clean(i.minimumWageSector),
  });
}

/** « Passer pour l'instant » : l'administrateur n'est plus redirigé vers le parcours, mais le rappel reste affiché tant qu'il n'est pas terminé. */
export async function skipSetup(ctx: Ctx) {
  await ctx.db.company.update({ where: { id: ctx.company.id }, data: { setupSkippedAt: new Date() } });
}

/** « Terminer » : le dossier est considéré comme complété (le rappel disparaît). */
export async function completeSetup(ctx: Ctx) {
  const c = await ctx.db.company.findFirstOrThrow({ where: { id: ctx.company.id }, select: { onboardingCompletedAt: true } });
  if (c.onboardingCompletedAt) return;
  await ctx.db.company.update({ where: { id: ctx.company.id }, data: { onboardingCompletedAt: new Date() } });
  await audit(ctx as TenantContext, {
    action: "company.setup_complete", resource: "Company", resourceId: ctx.company.id,
    summary: `${ctx.user.name} a terminé le paramétrage de l'entreprise.`,
  });
}
