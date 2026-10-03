"use server";

import { definePublicAction } from "@/core/actions/define";
import { enforceRateLimit } from "@/core/security/rate-limit";
import { recordDemoRequest } from "@/modules/platform/demo";
import { demoRequestSchema } from "./schemas";

export const submitDemoRequestAction = definePublicAction({
  input: demoRequestSchema,
  handler: async ({ input }) => {
    // Champ piège rempli → on feint le succès sans rien enregistrer.
    if (input.website) return { received: true };
    await enforceRateLimit("demo", { limit: 5, windowMs: 3_600_000 });
    await recordDemoRequest(input);
    return { received: true };
  },
});
