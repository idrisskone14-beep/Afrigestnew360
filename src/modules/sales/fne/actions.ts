"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { businessRule } from "@/core/errors";
import { z } from "zod";
import { certifyInvoiceSchema, fneSettingsSchema } from "./schemas";
import { certifyCreditNote, certifyInvoice, saveFneSettings, type FneOutcome } from "./service";

const M = "sales";
const bust = () => { revalidatePath("/app/sales", "layout"); revalidatePath("/app/parametres/fne"); };

/** Un refus ou une panne est enregistré sur le document ; l'utilisateur reçoit le motif comme erreur. */
const settle = (o: FneOutcome) => {
  if (o.status !== "CERTIFIED") throw businessRule(o.message);
  return { reference: o.reference, stickerWarning: o.stickerWarning };
};

export const saveFneSettingsAction = defineTenantAction({
  input: fneSettingsSchema, module: M, permission: "settings.company.update",
  handler: async ({ ctx, input }) => { await saveFneSettings(ctx, input); bust(); },
});

export const certifyInvoiceAction = defineTenantAction({
  input: certifyInvoiceSchema, module: M, permission: "finance.invoice.update",
  handler: async ({ ctx, input }) => { const o = await certifyInvoice(ctx, input.id, { template: input.template, paymentMethod: input.paymentMethod }); bust(); return settle(o); },
});

export const certifyCreditNoteAction = defineTenantAction({
  input: z.object({ id: z.string().uuid() }), module: M, permission: "finance.credit_note.update",
  handler: async ({ ctx, input }) => { const o = await certifyCreditNote(ctx, input.id); bust(); return settle(o); },
});
