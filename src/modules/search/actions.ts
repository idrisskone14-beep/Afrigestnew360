"use server";

import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { globalSearch } from "./service";

/** Recherche globale (palette ⌘/Ctrl+K) : n'interroge que les types lisibles par l'utilisateur, dans son entreprise active. */
export const globalSearchAction = defineTenantAction({
  input: z.object({ q: z.string().max(200) }),
  handler: async ({ ctx, input }) => globalSearch(ctx, input.q),
});
