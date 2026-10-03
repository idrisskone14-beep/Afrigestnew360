"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { businessRule } from "@/core/errors";
import { IMPORT_MAX_BYTES } from "./parse";
import { analyzeImport, discardImport, previewImport, runImport } from "./import-service";

const bust = () => revalidatePath("/app/parametres/donnees");
const P = "data.import.manage";

/** Téléverse un fichier CSV / Excel (FormData : entity, file). Le format est vérifié sur les octets ; 5 Mo et 2 000 lignes maximum. */
export const uploadImportAction = defineTenantAction({
  input: z.instanceof(FormData), permission: P,
  handler: async ({ ctx, input }) => {
    const file = input.get("file");
    const entity = input.get("entity");
    if (!(file instanceof File) || file.size === 0) throw businessRule("Choisissez un fichier.");
    if (file.size > IMPORT_MAX_BYTES) throw businessRule(`Le fichier dépasse ${IMPORT_MAX_BYTES / 1024 / 1024} Mo.`);
    const res = await analyzeImport(ctx, typeof entity === "string" ? entity : "", { name: file.name, size: file.size }, Buffer.from(await file.arrayBuffer()));
    bust();
    return res;
  },
});

export const previewImportAction = defineTenantAction({
  input: z.object({ id: z.string().uuid(), mapping: z.record(z.string().max(40), z.number().int().min(0).max(200)) }), permission: P,
  handler: async ({ ctx, input }) => { const r = await previewImport(ctx, input.id, input.mapping); bust(); return r; },
});

export const runImportAction = defineTenantAction({
  input: z.object({ id: z.string().uuid() }), permission: P,
  handler: async ({ ctx, input }) => { const r = await runImport(ctx, input.id); revalidatePath("/app", "layout"); return r; },
});

export const discardImportAction = defineTenantAction({
  input: z.object({ id: z.string().uuid() }), permission: P,
  handler: async ({ ctx, input }) => { await discardImport(ctx, input.id); bust(); },
});
