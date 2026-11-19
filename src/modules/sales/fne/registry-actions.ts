"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { businessRule } from "@/core/errors";
import { IMPORT_MAX_MB } from "@/lib/upload-limits";
import { IMPORT_MAX_BYTES } from "@/modules/data/parse";
import { fneFeatureEnabled } from "./feature";
import { importFneRegistry } from "./registry";

/** Importe l'export Excel de l'espace FNE (FormData : file). Les documents déjà connus (même numéro FNE) sont ignorés. */
export const importFneRegistryAction = defineTenantAction({
  input: z.instanceof(FormData),
  module: "sales",
  permission: "finance.invoice.create",
  handler: async ({ ctx, input }) => {
    if (!fneFeatureEnabled()) throw businessRule("La FNE n'est pas ouverte sur cette plateforme.");
    const file = input.get("file");
    if (!(file instanceof File) || file.size === 0) throw businessRule("Choisissez le fichier exporté depuis l'espace FNE.");
    if (file.size > IMPORT_MAX_BYTES) throw businessRule(`Le fichier dépasse ${IMPORT_MAX_MB} Mo : exportez une période plus courte.`);
    const res = await importFneRegistry(ctx, { name: file.name }, Buffer.from(await file.arrayBuffer()));
    revalidatePath("/app/sales/registre-fne");
    return res;
  },
});
