"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { budgetSchema, equipmentSchema, idSchema, materialSchema, memberSchema, planSchema, reportSchema, siteSchema, subcontractSchema, updateSiteSchema, updateSubcontractSchema } from "./schemas";
import * as svc from "./service";

const M = "construction";
const bust = () => { revalidatePath("/app/construction", "layout"); revalidatePath("/app/projects", "layout"); revalidatePath("/app/dashboard"); };
const MANAGE = "construction.site.manage";

export const createSiteAction = defineTenantAction({ input: siteSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { const s = await svc.createSite(ctx, input); bust(); return { id: s.id }; } });
export const updateSiteAction = defineTenantAction({ input: updateSiteSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.updateSite(ctx, input); bust(); } });
export const archiveSiteAction = defineTenantAction({ input: idSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.archiveSite(ctx, input.id); bust(); } });
export const setBudgetAction = defineTenantAction({ input: budgetSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.setBudget(ctx, input); bust(); } });
export const addMemberAction = defineTenantAction({ input: memberSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.addMember(ctx, input); bust(); } });
export const endMemberAction = defineTenantAction({ input: idSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.endMember(ctx, input.id); bust(); } });
export const addEquipmentAction = defineTenantAction({ input: equipmentSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.addEquipment(ctx, input); bust(); } });
export const endEquipmentAction = defineTenantAction({ input: idSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.endEquipment(ctx, input.id); bust(); } });
export const setMaterialPlanAction = defineTenantAction({ input: planSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.setMaterialPlan(ctx, input); bust(); } });
export const removeMaterialPlanAction = defineTenantAction({ input: idSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.removeMaterialPlan(ctx, input.id); bust(); } });
// Mouvement de stock réel : le droit « chantiers » ET le droit d'ajuster les stocks sont exigés
export const moveMaterialAction = defineTenantAction({ input: materialSchema, module: M, permission: [MANAGE, "inventory.movement.create"], handler: async ({ ctx, input }) => { await svc.moveMaterial(ctx, input); bust(); revalidatePath("/app/inventory", "layout"); } });
export const addSubcontractAction = defineTenantAction({ input: subcontractSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.addSubcontract(ctx, input); bust(); } });
export const updateSubcontractAction = defineTenantAction({ input: updateSubcontractSchema, module: M, permission: MANAGE, handler: async ({ ctx, input }) => { await svc.updateSubcontract(ctx, input); bust(); } });
export const saveReportAction = defineTenantAction({ input: reportSchema, module: M, permission: "construction.report.manage", handler: async ({ ctx, input }) => { const r = await svc.saveReport(ctx, input); bust(); return { id: r.id }; } });
