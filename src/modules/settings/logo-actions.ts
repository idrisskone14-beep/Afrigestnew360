"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { audit } from "@/core/audit";
import { AppError } from "@/core/errors";
import { LOGO_MAX_BYTES, saveCompanyLogo } from "@/core/storage";

/** Téléverse le logo de l'entreprise active (FormData : champ « logo »). Type vérifié sur les octets. */
export const uploadCompanyLogoAction = defineTenantAction({
  input: z.instanceof(FormData),
  permission: "settings.company.update",
  handler: async ({ ctx, input }) => {
    const file = input.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", "Choisissez une image.");
    if (file.size > LOGO_MAX_BYTES) throw new AppError("VALIDATION", "Le logo ne doit pas dépasser 1 Mo.");
    await saveCompanyLogo(ctx.company.id, Buffer.from(await file.arrayBuffer()));
    const logoUrl = `/api/files/logo/${ctx.company.id}?v=${Date.now()}`;
    await ctx.db.company.update({ where: { id: ctx.company.id }, data: { logoUrl } });
    await audit(ctx, { action: "company.logo_update", resource: "Company", resourceId: ctx.company.id, summary: `${ctx.user.name} a mis à jour le logo de l'entreprise.` });
    revalidatePath("/app", "layout");
    return { logoUrl };
  },
});
