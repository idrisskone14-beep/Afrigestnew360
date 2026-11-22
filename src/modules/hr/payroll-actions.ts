"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { payrollLinkSchema, savePayrollLink } from "./payroll-link";

/** Réglage de la liaison RH → paie : réservé à la paie (droit « gérer la paie »). */
export const savePayrollLinkAction = defineTenantAction({
  input: payrollLinkSchema, module: "payroll", permission: "hr.payroll.manage",
  handler: async ({ ctx, input }) => { await savePayrollLink(ctx, input); revalidatePath("/app/payroll", "layout"); },
});
