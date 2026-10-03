"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { decideApproval, savePolicy } from "@/core/approvals";
import { decisionSchema, policySchema } from "@/modules/purchasing/schemas";
import { idSchema, ruleSchema, toggleRuleSchema, updateRuleSchema } from "./schemas";
import * as svc from "./service";

const bust = () => { revalidatePath("/app/validations"); revalidatePath("/app/purchases", "layout"); revalidatePath("/app/finance", "layout"); revalidatePath("/app/sales", "layout"); revalidatePath("/app/hr", "layout"); };

/** Décision sur une demande d'approbation : l'éligibilité à l'étape courante est revérifiée côté serveur dans le moteur. */
export const decideApprovalAction = defineTenantAction({
  input: decisionSchema, permission: "workflow.request.approve",
  handler: async ({ ctx, input }) => { const r = await decideApproval(ctx, input); bust(); return r; },
});

export const savePolicyAction = defineTenantAction({
  input: policySchema, permission: "workflow.policy.manage",
  handler: async ({ ctx, input }) => { await savePolicy(ctx, input); revalidatePath("/app/parametres/validations"); },
});

const settings = () => revalidatePath("/app/parametres/validations");
export const createRuleAction = defineTenantAction({ input: ruleSchema, permission: "workflow.policy.manage", handler: async ({ ctx, input }) => { const r = await svc.createRule(ctx, input); settings(); return { id: r.id }; } });
export const updateRuleAction = defineTenantAction({ input: updateRuleSchema, permission: "workflow.policy.manage", handler: async ({ ctx, input }) => { await svc.updateRule(ctx, input); settings(); } });
export const toggleRuleAction = defineTenantAction({ input: toggleRuleSchema, permission: "workflow.policy.manage", handler: async ({ ctx, input }) => { await svc.toggleRule(ctx, input.id, input.isActive); settings(); } });
export const deleteRuleAction = defineTenantAction({ input: idSchema, permission: "workflow.policy.manage", handler: async ({ ctx, input }) => { await svc.deleteRule(ctx, input.id); settings(); } });
