import "server-only";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { NUMBERING_DEFAULTS, NUMBERING_KEYS, formatNumber, type NumberingKey } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import type { numberingSchema, taxSchema, updateTaxSchema } from "./schemas";

type Ctx = TenantContext;

// ── Taxes ─────────────────────────────────────────────────────

export const listTaxes = (ctx: Pick<Ctx, "db">) => ctx.db.tax.findMany({ orderBy: [{ isDefault: "desc" }, { rate: "desc" }, { name: "asc" }] });

export async function createTax(ctx: Ctx, input: z.output<typeof taxSchema>) {
  const tax = await ctx.tx(async (tx) => {
    if (input.isDefault) await tx.tax.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.tax.create({ data: { companyId: ctx.company.id, name: input.name, rate: input.rate, isDefault: input.isDefault } });
  });
  await audit(ctx, { action: "tax.create", resource: "Tax", resourceId: tax.id, summary: `${ctx.user.name} a créé la taxe « ${tax.name} » (${input.rate} %).`, after: tax });
  return tax;
}

export async function updateTax(ctx: Ctx, input: z.output<typeof updateTaxSchema>) {
  const before = await ctx.db.tax.findFirst({ where: { id: input.id } });
  if (!before) throw notFound("Taxe");
  if (!input.isActive && (input.isDefault || before.isDefault)) throw businessRule("La taxe par défaut ne peut pas être désactivée : choisissez-en une autre d'abord.");
  const after = await ctx.tx(async (tx) => {
    if (input.isDefault) await tx.tax.updateMany({ where: { isDefault: true, id: { not: input.id } }, data: { isDefault: false } });
    return tx.tax.update({ where: { id: input.id }, data: { name: input.name, rate: input.rate, isDefault: input.isDefault, isActive: input.isActive } });
  });
  await audit(ctx, { action: "tax.update", resource: "Tax", resourceId: after.id, summary: `${ctx.user.name} a modifié la taxe « ${after.name} ».`, before, after });
  return after;
}

// ── Numérotation ──────────────────────────────────────────────

export async function listNumbering(ctx: Pick<Ctx, "db">) {
  const [configs, seqs] = await Promise.all([ctx.db.numberingConfig.findMany(), ctx.db.numberSequence.findMany()]);
  const year = new Date().getFullYear();
  return NUMBERING_KEYS.map((key) => {
    const def = NUMBERING_DEFAULTS[key];
    const cfg = configs.find((c) => c.key === key);
    const fmt = { prefix: cfg?.prefix ?? def.prefix, padding: cfg?.padding ?? def.padding, withYear: cfg?.withYear ?? def.withYear, resetYearly: cfg?.resetYearly ?? true };
    const seqYear = fmt.resetYearly ? year : 0;
    const last = seqs.find((s) => s.key === key && s.year === seqYear)?.last ?? 0;
    return { key, label: def.label, ...fmt, last, next: formatNumber(fmt, last + 1, year) };
  });
}

export async function updateNumbering(ctx: Ctx, input: z.output<typeof numberingSchema>) {
  if (!(NUMBERING_KEYS as string[]).includes(input.key)) throw notFound("Type de document");
  const key = input.key as NumberingKey;
  const cfg = await ctx.db.numberingConfig.upsert({
    where: { companyId_key: { companyId: ctx.company.id, key } },
    create: { companyId: ctx.company.id, key, prefix: input.prefix, padding: input.padding, withYear: input.withYear, resetYearly: input.resetYearly },
    update: { prefix: input.prefix, padding: input.padding, withYear: input.withYear, resetYearly: input.resetYearly },
  });
  await audit(ctx, { action: "numbering.update", resource: "NumberingConfig", resourceId: cfg.id, summary: `${ctx.user.name} a modifié la numérotation « ${NUMBERING_DEFAULTS[key].label} ».`, after: cfg });
  return cfg;
}
