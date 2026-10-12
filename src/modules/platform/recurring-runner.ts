import "server-only";
import { platformDb } from "@/core/db/client";
import { systemContextFor } from "@/core/tenant/system-context";
import { runRecurring } from "@/modules/sales/recurring";

/**
 * Tâche planifiée : génère les factures récurrentes échues de toutes les entreprises. Travaille UNE entreprise à la fois,
 * au nom de l'auteur du modèle (ses droits, ses modules). Un modèle en erreur n'empêche pas les autres.
 */
export async function runAllDueRecurring(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const due = await platformDb.recurringInvoice.findMany({ where: { status: "ACTIVE", nextRunDate: { lte: today } }, select: { id: true, companyId: true, createdById: true }, orderBy: { nextRunDate: "asc" }, take: 1000 });
  let generated = 0, failed = 0, skipped = 0;
  const byCompany = new Map<string, typeof due>();
  for (const r of due) byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), r]);
  for (const [companyId, recs] of byCompany) {
    for (const r of recs) {
      try {
        const ctx = await systemContextFor(companyId, r.createdById);
        if (!ctx || !ctx.hasModule("sales")) { skipped++; continue; }
        const res = await runRecurring(ctx, r.id, { today });
        generated += res.generated;
        if (res.error) failed++;
      } catch (e) {
        failed++;
        console.error("[cron:recurring]", r.id, e instanceof Error ? e.message : e);
      }
    }
  }
  return { due: due.length, generated, failed, skipped };
}
