"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { setupFiscalSchema, setupIdentificationSchema, setupSocialSchema } from "@/core/tenant/setup-schemas";
import { completeSetup, saveSetupFiscal, saveSetupIdentification, saveSetupSocial, skipSetup } from "./setup";

const PERMISSION = "settings.company.update";
const refresh = () => revalidatePath("/app", "layout");

export const saveSetupIdentificationAction = defineTenantAction({
  input: setupIdentificationSchema,
  permission: PERMISSION,
  handler: async ({ ctx, input }) => { await saveSetupIdentification(ctx, input); refresh(); },
});

export const saveSetupFiscalAction = defineTenantAction({
  input: setupFiscalSchema,
  permission: PERMISSION,
  handler: async ({ ctx, input }) => { await saveSetupFiscal(ctx, input); refresh(); },
});

export const saveSetupSocialAction = defineTenantAction({
  input: setupSocialSchema,
  permission: PERMISSION,
  handler: async ({ ctx, input }) => { await saveSetupSocial(ctx, input); refresh(); },
});

export const skipSetupAction = defineTenantAction({
  input: z.object({}),
  permission: PERMISSION,
  handler: async ({ ctx }) => { await skipSetup(ctx); refresh(); },
});

export const completeSetupAction = defineTenantAction({
  input: z.object({}),
  permission: PERMISSION,
  handler: async ({ ctx }) => { await completeSetup(ctx); refresh(); },
});
