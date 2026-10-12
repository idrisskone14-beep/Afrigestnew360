"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineUserAction } from "@/core/actions/define";
import { platformDb } from "@/core/db/client";
import { AppError } from "@/core/errors";
import { setActiveCompanyCookie, setYearCookie } from "./cookies";

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

/** Année d'affichage des listes (cookie d'interface) ; ne donne accès à rien de plus. */
export const setYearAction = defineUserAction({
  input: z.object({ year: z.number().int().min(2000).max(2100) }),
  handler: async ({ input }) => {
    await setYearCookie(input.year);
    revalidatePath("/app", "layout");
  },
});
