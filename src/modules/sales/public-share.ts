import "server-only";
import { z } from "zod";
import { businessRule, notFound } from "@/core/errors";
import { d } from "@/core/money";
import { notify, usersWithPermission } from "@/core/notifications";
import { enforceRateLimit } from "@/core/security/rate-limit";
import { publicContext, recordShareView, resolveShare, type ResolvedShare } from "@/core/share/service";
import { sanitizeForAudit } from "@/core/audit";
import { headers } from "next/headers";
import { effectiveQuoteStatus } from "./quotes";
import { invoiceBalance, isOverdue } from "./invoices";
import type { PreviewData } from "./ui/document-preview";
import { invoicePreview, quotePreview } from "./ui/sales-editor-data";

/** Le logo de l'entreprise est servi par une route liée au lien (le visiteur n'a pas de session). */
const publicLogo = (p: PreviewData, token: string): PreviewData => ({ ...p, issuer: { ...p.issuer, logoUrl: p.issuer.logoUrl ? `/api/p/${token}/logo` : null } });

/** Ce que voit le client sur le lien public : le document et, pour un devis, la possibilité de répondre. */
export interface SharedDocument {
  kind: "QUOTE" | "INVOICE";
  title: string;
  number: string;
  company: string;
  preview: PreviewData;
  /** Devis : le client peut encore répondre. */
  canRespond: boolean;
  status: { label: string; tone: "info" | "success" | "danger" | "warning" | "neutral" };
  /** Réponse déjà donnée (devis). */
  response: { accepted: boolean; by: string | null; at: Date | null; note: string | null } | null;
  /** Facture : reste dû. */
  balance: number | null;
  share: ResolvedShare;
}

/** Charge le document derrière un lien public ; null si le lien est inconnu, révoqué ou périmé. Compte la consultation. */
export async function loadSharedDocument(token: string): Promise<SharedDocument | null> {
  const share = await resolveShare(token);
  if (!share) return null;
  const ctx = await publicContext(share.companyId);
  if (!ctx) return null;
  const company = ctx.company.tradeName ?? ctx.company.legalName;
  await recordShareView(share.id).catch(() => undefined);

  if (share.docType === "QUOTE") {
    const q = await ctx.db.quote.findFirst({ where: { id: share.docId }, include: { lines: { orderBy: { position: "asc" } }, customer: true } });
    if (!q) return null;
    const eff = effectiveQuoteStatus(q);
    const canRespond = q.kind === "QUOTE" && q.status === "SENT" && eff !== "EXPIRED";
    const status = q.status === "ACCEPTED" ? { label: "Accepté", tone: "success" as const }
      : q.status === "REJECTED" ? { label: "Refusé", tone: "danger" as const }
      : q.status === "CONVERTED" ? { label: "Accepté", tone: "success" as const }
      : eff === "EXPIRED" ? { label: "Expiré", tone: "warning" as const }
      : { label: q.kind === "PROFORMA" ? "Facture proforma" : "En attente de votre réponse", tone: "info" as const };
    return {
      kind: "QUOTE", title: q.kind === "PROFORMA" ? "Facture proforma" : "Devis", number: q.number, company, preview: publicLogo(await quotePreview(ctx, q), token), canRespond, status,
      response: q.respondedAt ? { accepted: q.status !== "REJECTED", by: q.respondedByName, at: q.respondedAt, note: q.responseNote } : null, balance: null, share,
    };
  }

  const i = await ctx.db.invoice.findFirst({
    where: { id: share.docId },
    include: { lines: { orderBy: { position: "asc" } }, customer: true, installments: true, payments: true, creditNotes: true, reminders: true },
  });
  if (!i || i.status === "DRAFT") return null;
  const balance = invoiceBalance(i).toNumber();
  const status = i.status === "CANCELLED" ? { label: "Annulée", tone: "danger" as const }
    : i.status === "PAID" || balance <= 0 ? { label: "Payée", tone: "success" as const }
    : isOverdue(i) ? { label: "Échue", tone: "danger" as const }
    : { label: "À régler", tone: "info" as const };
  return { kind: "INVOICE", title: "Facture", number: i.number ?? "", company, preview: publicLogo(await invoicePreview(ctx, i, balance), token), canRespond: false, status, response: null, balance: i.status === "CANCELLED" ? null : balance, share };
}

/** PDF du document partagé (même rendu que le PDF interne). */
export async function sharedDocumentPdf(token: string) {
  const share = await resolveShare(token);
  if (!share) throw notFound("Document");
  const ctx = await publicContext(share.companyId);
  if (!ctx) throw notFound("Document");
  const { buildPdf } = await import("./pdf");
  if (share.docType === "INVOICE") {
    const i = await ctx.db.invoice.findFirst({ where: { id: share.docId }, select: { status: true } });
    if (!i || i.status === "DRAFT") throw notFound("Document");
  }
  return buildPdf(ctx, share.docType === "QUOTE" ? "quote" : "invoice", share.docId);
}

export const respondSchema = z.object({
  token: z.string().min(20).max(64),
  decision: z.enum(["ACCEPT", "REJECT"]),
  name: z.string().trim().min(2, "Indiquez votre nom").max(100),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

/**
 * Réponse du client à un devis depuis le lien public : accepté ou refusé, avec son nom et un commentaire éventuel.
 * Journalisé (adresse IP comprise) et notifié aux commerciaux. Possible une seule fois, tant que le devis est « envoyé » et valide.
 */
export async function respondToSharedQuote(input: z.output<typeof respondSchema>) {
  await enforceRateLimit("share-respond", { limit: 10, windowMs: 15 * 60_000 });
  const share = await resolveShare(input.token);
  if (!share || share.docType !== "QUOTE") throw notFound("Devis");
  const ctx = await publicContext(share.companyId);
  if (!ctx) throw notFound("Devis");

  const q = await ctx.db.quote.findFirst({ where: { id: share.docId }, select: { id: true, number: true, kind: true, status: true, validUntil: true, total: true, currency: true, createdById: true, customer: { select: { name: true } } } });
  if (!q) throw notFound("Devis");
  if (q.kind !== "QUOTE") throw businessRule("Ce document n'appelle pas de réponse.");
  if (q.status === "ACCEPTED" || q.status === "REJECTED" || q.status === "CONVERTED") throw businessRule("Une réponse a déjà été donnée pour ce devis.");
  if (q.status !== "SENT") throw businessRule("Ce devis n'est pas ouvert à la réponse.");
  if (effectiveQuoteStatus(q) === "EXPIRED") throw businessRule("Ce devis est expiré : contactez l'entreprise pour obtenir une nouvelle proposition.");

  const accepted = input.decision === "ACCEPT";
  const note = input.note?.trim() || null;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const company = ctx.company.tradeName ?? ctx.company.legalName;

  await ctx.tx(async (tx) => {
    // condition sur le statut : deux réponses simultanées ne passent pas toutes les deux
    const res = await tx.quote.updateMany({ where: { id: q.id, status: "SENT" }, data: { status: accepted ? "ACCEPTED" : "REJECTED", respondedAt: new Date(), respondedByName: input.name, responseNote: note } });
    if (res.count !== 1) throw businessRule("Une réponse a déjà été donnée pour ce devis.");
    await tx.auditLog.create({
      data: {
        companyId: ctx.company.id, userId: null, userLabel: `${input.name} (client, lien public)`, action: accepted ? "quote.accepted_online" : "quote.rejected_online", resource: "Quote", resourceId: q.id,
        summary: `${input.name} a ${accepted ? "accepté" : "refusé"} en ligne le devis ${q.number}${note ? ` : « ${note.slice(0, 120)} »` : ""}.`, after: sanitizeForAudit({ decision: input.decision }) as never, ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      },
    });
    const audience = [...new Set([...(q.createdById ? [q.createdById] : []), ...(await usersWithPermission(tx, "sales.quote.update"))])];
    await notify(tx, {
      companyId: ctx.company.id, userIds: audience, type: "quote.responded",
      title: `Devis ${q.number} ${accepted ? "accepté" : "refusé"} par ${q.customer.name}`,
      body: `${input.name} a ${accepted ? "accepté" : "refusé"} le devis (${d(q.total).toNumber().toLocaleString("fr-FR")} ${q.currency}).${note ? ` Commentaire : ${note}` : ""}`, link: `/app/sales/devis/${q.id}`,
    });
  });
  return { accepted, company, number: q.number };
}
