"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import {
  branchSchema, costCenterSchema, departmentSchema, siteSchema, updateBranchSchema, updateCostCenterSchema, updateDepartmentSchema, updateSiteSchema,
} from "./schemas";
import * as svc from "./service";

const bust = () => revalidatePath("/app/parametres/organisation");
const P = "org.structure.manage";

export const createBranchAction = defineTenantAction({ input: branchSchema, permission: P, handler: async ({ ctx, input }) => { await svc.createBranch(ctx, input); bust(); } });
export const updateBranchAction = defineTenantAction({ input: updateBranchSchema, permission: P, handler: async ({ ctx, input }) => { await svc.updateBranch(ctx, input); bust(); } });
export const createSiteAction = defineTenantAction({ input: siteSchema, permission: P, handler: async ({ ctx, input }) => { await svc.createSite(ctx, input); bust(); } });
export const updateSiteAction = defineTenantAction({ input: updateSiteSchema, permission: P, handler: async ({ ctx, input }) => { await svc.updateSite(ctx, input); bust(); } });
export const createDepartmentAction = defineTenantAction({ input: departmentSchema, permission: P, handler: async ({ ctx, input }) => { await svc.createDepartment(ctx, input); bust(); } });
export const updateDepartmentAction = defineTenantAction({ input: updateDepartmentSchema, permission: P, handler: async ({ ctx, input }) => { await svc.updateDepartment(ctx, input); bust(); } });
export const createCostCenterAction = defineTenantAction({ input: costCenterSchema, permission: P, handler: async ({ ctx, input }) => { await svc.createCostCenter(ctx, input); bust(); } });
export const updateCostCenterAction = defineTenantAction({ input: updateCostCenterSchema, permission: P, handler: async ({ ctx, input }) => { await svc.updateCostCenter(ctx, input); bust(); } });
