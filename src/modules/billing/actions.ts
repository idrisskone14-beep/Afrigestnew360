"use server";

import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { audit } from "@/core/audit";
import { enforceRateLimit } from "@/core/security/rate-limit";
import { startSubscriptionPayment } from "@/modules/platform/billing";

const payInput = z.object({ planId: z.uuid(), cycle: z.enum(["MONTHLY", "YEARLY"]) });

/** Lance le paiement en ligne de l'abonnement ; renvoie l'adresse de la page PayDunya où rediriger l'utilisateur. */
export const startSubscriptionPaymentAction = defineTenantAction({
  input: payInput,
  permission: "settings.billing.update",
  handler: async ({ ctx, input }) => {
    await enforceRateLimit("billing-pay", { limit: 10, windowMs: 10 * 60_000 });
    const { url } = await startSubscriptionPayment(ctx, input);
    await audit(ctx, {
      action: "subscription.payment_started", resource: "SubscriptionPayment",
      summary: `${ctx.user.name} a démarré le paiement de l'abonnement (${input.cycle === "YEARLY" ? "annuel" : "mensuel"}).`,
    });
    return { url };
  },
});
