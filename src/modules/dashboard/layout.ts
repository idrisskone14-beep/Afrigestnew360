import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/core/tenant/context";
import { availableWidgets } from "./widgets";

type Ctx = TenantContext;
export interface LayoutItem { key: string; visible: boolean }

export const layoutSchema = z.object({
  layout: z.array(z.object({ key: z.string().min(1).max(40), visible: z.boolean() })).max(50),
});

/**
 * Disposition effective d'un utilisateur : son ordre enregistré (limité aux widgets qu'il peut voir), puis les nouveaux widgets
 * disponibles ajoutés à la fin. Une clé inconnue ou non autorisée est ignorée : on ne fait jamais confiance à la disposition stockée.
 */
export async function getLayout(ctx: Ctx): Promise<LayoutItem[]> {
  const allowed = availableWidgets(ctx).map((w) => w.key);
  const pref = await ctx.db.dashboardPreference.findFirst({ where: { userId: ctx.user.id } });
  const stored = layoutSchema.shape.layout.safeParse(pref?.layout);
  const saved = stored.success ? stored.data.filter((l) => allowed.includes(l.key)) : [];
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const l of saved) if (!seen.has(l.key)) { seen.add(l.key); out.push(l); }
  for (const key of allowed) if (!seen.has(key)) out.push({ key, visible: true });
  return out;
}

export async function saveLayout(ctx: Ctx, input: z.output<typeof layoutSchema>) {
  const allowed = new Set(availableWidgets(ctx).map((w) => w.key));
  const clean: LayoutItem[] = [];
  const seen = new Set<string>();
  for (const l of input.layout) if (allowed.has(l.key) && !seen.has(l.key)) { seen.add(l.key); clean.push({ key: l.key, visible: l.visible }); }
  await ctx.db.dashboardPreference.upsert({
    where: { companyId_userId: { companyId: ctx.company.id, userId: ctx.user.id } },
    create: { companyId: ctx.company.id, userId: ctx.user.id, layout: JSON.parse(JSON.stringify(clean)) },
    update: { layout: JSON.parse(JSON.stringify(clean)) },
  });
  return clean;
}

export async function resetLayout(ctx: Ctx) {
  await ctx.db.dashboardPreference.deleteMany({ where: { userId: ctx.user.id } });
}
