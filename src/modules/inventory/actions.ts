"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { audit } from "@/core/audit";
import {
  categorySchema, countSchema, idSchema, movementSchema, productSchema, stockSettingsSchema, updateCategorySchema, updateProductSchema, updateWarehouseSchema, warehouseSchema,
} from "./schemas";
import * as inv from "./service";

const bust = () => revalidatePath("/app/inventory", "layout");

export const createProductAction = defineTenantAction({ input: productSchema, permission: "inventory.product.create", handler: async ({ ctx, input }) => { const p = await inv.createProduct(ctx, input); bust(); return { id: p.id }; } });
export const updateProductAction = defineTenantAction({ input: updateProductSchema, permission: "inventory.product.update", handler: async ({ ctx, input }) => { await inv.updateProduct(ctx, input); bust(); } });
export const archiveProductAction = defineTenantAction({ input: idSchema, permission: "inventory.product.delete", handler: async ({ ctx, input }) => { await inv.archiveProduct(ctx, input.id); bust(); } });

export const createCategoryAction = defineTenantAction({ input: categorySchema, permission: "inventory.product.update", handler: async ({ ctx, input }) => { await inv.createCategory(ctx, input); bust(); } });
export const renameCategoryAction = defineTenantAction({ input: updateCategorySchema, permission: "inventory.product.update", handler: async ({ ctx, input }) => { await inv.renameCategory(ctx, input); bust(); } });
export const deleteCategoryAction = defineTenantAction({ input: idSchema, permission: "inventory.product.update", handler: async ({ ctx, input }) => { await inv.deleteCategory(ctx, input.id); bust(); } });

export const createWarehouseAction = defineTenantAction({ input: warehouseSchema, permission: "inventory.warehouse.manage", handler: async ({ ctx, input }) => { await inv.createWarehouse(ctx, input); bust(); } });
export const updateWarehouseAction = defineTenantAction({ input: updateWarehouseSchema, permission: "inventory.warehouse.manage", handler: async ({ ctx, input }) => { await inv.updateWarehouse(ctx, input); bust(); } });
export const archiveWarehouseAction = defineTenantAction({ input: idSchema, permission: "inventory.warehouse.manage", handler: async ({ ctx, input }) => { await inv.archiveWarehouse(ctx, input.id); bust(); } });

export const stockMovementAction = defineTenantAction({
  input: movementSchema,
  permission: "inventory.movement.create",
  handler: async ({ ctx, input }) => {
    if (input.kind === "ADJUSTMENT") ctx.assertCan("inventory.stock.adjust");
    await inv.manualMovement(ctx, input);
    bust();
  },
});

export const applyCountAction = defineTenantAction({ input: countSchema, permission: ["inventory.count.manage", "inventory.stock.adjust"], handler: async ({ ctx, input }) => { const r = await inv.applyCount(ctx, input); bust(); return r; } });

export const updateStockSettingsAction = defineTenantAction({
  input: stockSettingsSchema,
  permission: "inventory.warehouse.manage",
  handler: async ({ ctx, input }) => {
    await ctx.db.company.update({ where: { id: ctx.company.id }, data: { allowNegativeStock: input.allowNegativeStock } });
    await audit(ctx, { action: "stock.settings", resource: "Company", resourceId: ctx.company.id, summary: `${ctx.user.name} a ${input.allowNegativeStock ? "autorisé" : "interdit"} le stock négatif.` });
    bust();
  },
});
