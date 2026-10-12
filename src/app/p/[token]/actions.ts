"use server";

import { toActionError } from "@/core/actions/define";
import { ok, type ActionResult } from "@/core/errors";
import { respondSchema, respondToSharedQuote } from "@/modules/sales/public-share";

/** Réponse d'un client à un devis depuis le lien public (aucune session : le secret du lien fait foi). */
export async function respondToQuoteAction(raw: unknown): Promise<ActionResult<{ accepted: boolean; company: string; number: string }>> {
  try {
    return ok(await respondToSharedQuote(respondSchema.parse(raw)));
  } catch (e) {
    return toActionError(e);
  }
}
