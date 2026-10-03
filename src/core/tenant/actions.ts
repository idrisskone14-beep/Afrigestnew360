"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineUserAction } from "@/core/actions/define";
import { platformDb } from "@/core/db/client";
import { AppError } from "@/core/errors";
import { setActiveCompanyCookie } from "./cookies";

/**
 * Change l'entreprise active. Le cookie n'est posé que si l'utilisateur est membre ACTIF d'une
 * entreprise ACTIVE ; il est de toute façon revérifié à chaque requête (loadContextState).
 */
export const switchCompanyAction = defineUserAction({
  input: z.object({ companyId: z.string().uuid() }),
  handler: async ({ session, input }) => {
    const membership = await platformDb.companyMembership.findUnique({
      where: { userId_companyId: { userId: session.user.id, companyId: input.companyId } },
      include: { company: { select: { status: true, deletedAt: true } } },
    });
    if (!membership || membership.status !== "ACTIVE" || membership.company.deletedAt || membership.company.status !== "ACTIVE") {
      throw new AppError("FORBIDDEN", "Vous n'avez pas accès à cette entreprise.");
    }
    await setActiveCompanyCookie(input.companyId);
    revalidatePath("/app", "layout");
  },
});
