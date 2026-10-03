"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { createTax, updateNumbering, updateTax } from "./config";
import { numberingSchema, taxSchema, updateTaxSchema } from "./schemas";

export const createTaxAction = defineTenantAction({ input: taxSchema, permission: "settings.tax.manage", handler: async ({ ctx, input }) => { await createTax(ctx, input); revalidatePath("/app/parametres/taxes"); } });
export const updateTaxAction = defineTenantAction({ input: updateTaxSchema, permission: "settings.tax.manage", handler: async ({ ctx, input }) => { await updateTax(ctx, input); revalidatePath("/app/parametres/taxes"); } });
export const updateNumberingAction = defineTenantAction({ input: numberingSchema, permission: "settings.numbering.manage", handler: async ({ ctx, input }) => { await updateNumbering(ctx, input); revalidatePath("/app/parametres/numerotation"); } });
