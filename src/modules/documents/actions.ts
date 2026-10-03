"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import { businessRule } from "@/core/errors";
import { documentMetaSchema, entityTypeSchema, folderSchema, idSchema, linkSchema, renameFolderSchema, shareSchema, unshareSchema, updateDocumentSchema } from "./schemas";
import * as svc from "./service";

const M = "documents";
// Les panneaux « Documents » vivent dans les fiches des autres modules : on rafraîchit l'ensemble de l'application
const bust = () => revalidatePath("/app", "layout");

const fileOf = (form: FormData) => {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) throw businessRule("Choisissez un fichier.");
  return f;
};
const str = (form: FormData, k: string) => { const v = form.get(k); return typeof v === "string" ? v : undefined; };

/** Nouveau document (FormData : file, name, description, folderId, visibility, tags, entityType + entityId optionnels). */
export const uploadDocumentAction = defineTenantAction({
  input: z.instanceof(FormData), module: M, permission: "documents.document.create",
  handler: async ({ ctx, input }) => {
    const file = fileOf(input);
    const meta = documentMetaSchema.parse({ name: str(input, "name") || file.name.replace(/\.[^.]+$/, ""), description: str(input, "description"), folderId: str(input, "folderId"), visibility: str(input, "visibility") || "COMPANY", tags: str(input, "tags"), expiresAt: str(input, "expiresAt") });
    const t = str(input, "entityType"), id = str(input, "entityId");
    const link = t || id ? { entityType: entityTypeSchema.parse(t), entityId: z.string().uuid().parse(id) } : undefined;
    const doc = await svc.createDocument(ctx, meta, { name: file.name, size: file.size }, Buffer.from(await file.arrayBuffer()), link);
    bust();
    return { id: doc.id };
  },
});

/** Nouvelle version (FormData : id, file, comment). */
export const uploadVersionAction = defineTenantAction({
  input: z.instanceof(FormData), module: M, permission: "documents.document.update",
  handler: async ({ ctx, input }) => {
    const file = fileOf(input);
    const r = await svc.addVersion(ctx, z.string().uuid().parse(str(input, "id")), { name: file.name, size: file.size }, Buffer.from(await file.arrayBuffer()), str(input, "comment"));
    bust();
    return r;
  },
});

export const updateDocumentAction = defineTenantAction({ input: updateDocumentSchema, module: M, permission: "documents.document.update", handler: async ({ ctx, input }) => { await svc.updateDocument(ctx, input); bust(); } });
export const archiveDocumentAction = defineTenantAction({ input: idSchema, module: M, permission: "documents.document.update", handler: async ({ ctx, input }) => { await svc.setArchived(ctx, input.id, true); bust(); } });
export const restoreDocumentAction = defineTenantAction({ input: idSchema, module: M, permission: "documents.document.update", handler: async ({ ctx, input }) => { await svc.setArchived(ctx, input.id, false); bust(); } });
export const deleteDocumentAction = defineTenantAction({ input: idSchema, module: M, permission: "documents.document.delete", handler: async ({ ctx, input }) => { await svc.deleteDocument(ctx, input.id); bust(); } });

export const linkDocumentAction = defineTenantAction({ input: linkSchema, module: M, permission: "documents.document.update", handler: async ({ ctx, input }) => { await svc.linkDocument(ctx, input); bust(); } });
export const unlinkDocumentAction = defineTenantAction({ input: idSchema, module: M, permission: "documents.document.update", handler: async ({ ctx, input }) => { await svc.unlinkDocument(ctx, input.id); bust(); } });
export const shareDocumentAction = defineTenantAction({ input: shareSchema, module: M, permission: "documents.document.share", handler: async ({ ctx, input }) => { await svc.shareDocument(ctx, input); bust(); } });
export const unshareDocumentAction = defineTenantAction({ input: unshareSchema, module: M, permission: "documents.document.share", handler: async ({ ctx, input }) => { await svc.unshareDocument(ctx, input.id, input.userId); bust(); } });

export const createFolderAction = defineTenantAction({ input: folderSchema, module: M, permission: "documents.document.create", handler: async ({ ctx, input }) => { const f = await svc.createFolder(ctx, input); bust(); return { id: f.id }; } });
export const renameFolderAction = defineTenantAction({ input: renameFolderSchema, module: M, permission: "documents.document.update", handler: async ({ ctx, input }) => { await svc.renameFolder(ctx, input.id, input.name); bust(); } });
export const deleteFolderAction = defineTenantAction({ input: idSchema, module: M, permission: "documents.document.delete", handler: async ({ ctx, input }) => { await svc.deleteFolder(ctx, input.id); bust(); } });
