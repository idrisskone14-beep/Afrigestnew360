"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import {
  activitySchema, completeActivitySchema, contactSchema, convertLeadSchema, customerSchema, idSchema, leadSchema, moveOpportunitySchema,
  moveStageSchema, opportunitySchema, stageSchema, updateContactSchema, updateCustomerSchema, updateLeadSchema, updateOpportunitySchema, updateStageSchema,
} from "./schemas";
import * as crm from "./service";

const bust = () => revalidatePath("/app/crm", "layout");

// Clients
export const createCustomerAction = defineTenantAction({ input: customerSchema, permission: "crm.customer.create", handler: async ({ ctx, input }) => { const c = await crm.createCustomer(ctx, input); bust(); return { id: c.id }; } });
export const updateCustomerAction = defineTenantAction({ input: updateCustomerSchema, permission: "crm.customer.update", handler: async ({ ctx, input }) => { await crm.updateCustomer(ctx, input); bust(); } });
export const archiveCustomerAction = defineTenantAction({
  input: idSchema, permission: "crm.customer.delete",
  handler: async ({ ctx, input }) => {
    // Les modules Ventes/Finance ajoutent leurs garde-fous (facture impayée, etc.) via `customerArchiveGuards`.
    const { customerArchiveGuards } = await import("@/modules/sales/guards");
    await crm.archiveCustomer(ctx, input.id, customerArchiveGuards);
    bust();
  },
});

// Contacts
export const addContactAction = defineTenantAction({ input: contactSchema, permission: "crm.customer.update", handler: async ({ ctx, input }) => { await crm.addContact(ctx, input); bust(); } });
export const updateContactAction = defineTenantAction({ input: updateContactSchema, permission: "crm.customer.update", handler: async ({ ctx, input }) => { await crm.updateContact(ctx, input); bust(); } });
export const deleteContactAction = defineTenantAction({ input: idSchema, permission: "crm.customer.update", handler: async ({ ctx, input }) => { await crm.deleteContact(ctx, input.id); bust(); } });

// Prospects
export const createLeadAction = defineTenantAction({ input: leadSchema, permission: "crm.lead.create", handler: async ({ ctx, input }) => { await crm.createLead(ctx, input); bust(); } });
export const updateLeadAction = defineTenantAction({ input: updateLeadSchema, permission: "crm.lead.update", handler: async ({ ctx, input }) => { await crm.updateLead(ctx, input); bust(); } });
export const deleteLeadAction = defineTenantAction({ input: idSchema, permission: "crm.lead.delete", handler: async ({ ctx, input }) => { await crm.deleteLead(ctx, input.id); bust(); } });
export const convertLeadAction = defineTenantAction({
  input: convertLeadSchema,
  // convertir crée un client : les deux droits sont exigés
  permission: ["crm.lead.update", "crm.customer.create"],
  handler: async ({ ctx, input }) => { const r = await crm.convertLead(ctx, input); bust(); return { customerId: r.customer.id }; },
});

// Pipeline
export const createStageAction = defineTenantAction({ input: stageSchema, permission: "crm.pipeline.manage", handler: async ({ ctx, input }) => { await crm.createStage(ctx, input); bust(); } });
export const updateStageAction = defineTenantAction({ input: updateStageSchema, permission: "crm.pipeline.manage", handler: async ({ ctx, input }) => { await crm.updateStage(ctx, input); bust(); } });
export const moveStageAction = defineTenantAction({ input: moveStageSchema, permission: "crm.pipeline.manage", handler: async ({ ctx, input }) => { await crm.moveStage(ctx, input); bust(); } });
export const deleteStageAction = defineTenantAction({ input: idSchema, permission: "crm.pipeline.manage", handler: async ({ ctx, input }) => { await crm.deleteStage(ctx, input.id); bust(); } });

// Opportunités
export const createOpportunityAction = defineTenantAction({ input: opportunitySchema, permission: "crm.opportunity.create", handler: async ({ ctx, input }) => { await crm.createOpportunity(ctx, input); bust(); } });
export const updateOpportunityAction = defineTenantAction({ input: updateOpportunitySchema, permission: "crm.opportunity.update", handler: async ({ ctx, input }) => { await crm.updateOpportunity(ctx, input); bust(); } });
export const moveOpportunityAction = defineTenantAction({ input: moveOpportunitySchema, permission: "crm.opportunity.update", handler: async ({ ctx, input }) => { await crm.moveOpportunity(ctx, input); bust(); } });
export const deleteOpportunityAction = defineTenantAction({ input: idSchema, permission: "crm.opportunity.delete", handler: async ({ ctx, input }) => { await crm.deleteOpportunity(ctx, input.id); bust(); } });

// Activités
export const createActivityAction = defineTenantAction({ input: activitySchema, permission: "crm.activity.create", handler: async ({ ctx, input }) => { await crm.createActivity(ctx, input); bust(); } });
export const completeActivityAction = defineTenantAction({ input: completeActivitySchema, permission: "crm.activity.update", handler: async ({ ctx, input }) => { await crm.setActivityDone(ctx, input); bust(); } });
export const deleteActivityAction = defineTenantAction({ input: idSchema, permission: "crm.activity.update", handler: async ({ ctx, input }) => { await crm.deleteActivity(ctx, input.id); bust(); } });
