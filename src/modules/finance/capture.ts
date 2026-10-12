import "server-only";
import { z } from "zod";
import { businessRule } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { createDocument } from "@/modules/documents/service";
import { documentMetaSchema } from "@/modules/documents/schemas";
import { createExpense } from "./expenses";
import { expenseSchema } from "./schemas";

/**
 * Dépense saisie depuis le téléphone avec la photo du justificatif : la dépense est créée (brouillon, circuit habituel de validation),
 * puis la photo est rattachée à la dépense dans les Documents. Si la photo ne peut pas être enregistrée, la dépense existe quand même :
 * le message le dit et le justificatif peut être ajouté depuis la fiche.
 */
export const captureSchema = expenseSchema.pick({ date: true, categoryId: true, description: true, amount: true, method: true });

export async function captureExpense(ctx: TenantContext, raw: z.input<typeof captureSchema>, photo: File | null) {
  const input = expenseSchema.parse({ ...captureSchema.parse(raw), reference: "", notes: "Saisie depuis le téléphone avec photo du justificatif." });
  if (photo && photo.size === 0) throw businessRule("La photo est vide : reprenez-la.");
  const expense = await createExpense(ctx, input);
  if (!photo) return { id: expense.id, number: expense.number, attached: false, warning: null as string | null };
  if (!ctx.hasModule("documents") || !ctx.can("documents.document.create")) {
    return { id: expense.id, number: expense.number, attached: false, warning: "Dépense créée, mais la photo n'a pas été jointe : vous n'avez pas accès aux Documents." };
  }
  try {
    const meta = documentMetaSchema.parse({ name: `Justificatif ${expense.number}`, description: "Photo prise depuis le téléphone", visibility: "COMPANY" });
    await createDocument(ctx, meta, { name: photo.name || "justificatif.jpg", size: photo.size }, Buffer.from(await photo.arrayBuffer()), { entityType: "expense", entityId: expense.id });
    return { id: expense.id, number: expense.number, attached: true, warning: null };
  } catch (e) {
    return { id: expense.id, number: expense.number, attached: false, warning: `Dépense créée, mais la photo n'a pas pu être jointe (${e instanceof Error ? e.message : "erreur"}). Ajoutez-la depuis la fiche de la dépense.` };
  }
}
