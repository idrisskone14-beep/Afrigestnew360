"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { layoutSchema, resetLayout, saveLayout } from "./layout";

/** Disposition personnelle : aucune permission métier requise, mais seuls les widgets autorisés sont conservés. */
export const saveLayoutAction = defineTenantAction({ input: layoutSchema, handler: async ({ ctx, input }) => { await saveLayout(ctx, input); revalidatePath("/app/dashboard"); } });
export const resetLayoutAction = defineTenantAction({ input: z.object({}), handler: async ({ ctx }) => { await resetLayout(ctx); revalidatePath("/app/dashboard"); } });
