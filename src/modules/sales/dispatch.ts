import "server-only";
import { audit } from "@/core/audit";
import { businessRule } from "@/core/errors";
import { d } from "@/core/money";
import { sendMail } from "@/core/mail";
import { ensureShareLink, type ShareDocType } from "@/core/share/service";
import type { TenantContext } from "@/core/tenant/context";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { buildPdf } from "./pdf";
import { effectiveQuoteStatus, getQuote } from "./quotes";
import { getInvoice } from "./invoices";

type Ctx = TenantContext;
export type SendableKind = "quote" | "invoice";
const DOC_TYPE: Record<SendableKind, ShareDocType> = { quote: "QUOTE", invoice: "INVOICE" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Message proposé dans la fenêtre d'envoi (modifiable par l'utilisateur). */
export async function sendDefaults(ctx: Ctx, kind: SendableKind, id: string) {
  const company = ctx.company.tradeName ?? ctx.company.legalName;
  if (kind === "quote") {
    const q = await getQuote(ctx, id);
    const label = q.kind === "PROFORMA" ? "facture proforma" : "devis";
    return {
      to: q.customer.email ?? "",
      subject: `${q.kind === "PROFORMA" ? "Facture proforma" : "Devis"} ${q.number} — ${company}`,
      message: `Bonjour,\n\nVeuillez trouver ci-joint notre ${label} n° ${q.number} d'un montant de ${formatMoney(d(q.total).toNumber(), q.currency)}${q.validUntil ? `, valable jusqu'au ${fmtDate(q.validUntil)}` : ""}.${q.kind === "QUOTE" ? "\nVous pouvez le consulter et l'accepter en ligne en un clic." : ""}\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n${company}`,
      customerName: q.customer.name,
    };
  }
  const i = await getInvoice(ctx, id);
  return {
    to: i.customer.email ?? "",
    subject: `Facture ${i.number ?? ""} — ${company}`.replace("  ", " "),
    message: `Bonjour,\n\nVeuillez trouver ci-joint notre facture n° ${i.number} d'un montant de ${formatMoney(d(i.total).toNumber(), i.currency)}${i.dueDate ? `, à régler avant le ${fmtDate(i.dueDate)}` : ""}.\n\nMerci de votre confiance.\n\nCordialement,\n${company}`,
    customerName: i.customer.name,
  };
}

export interface SendInput { kind: SendableKind; id: string; to: string; subject: string; message: string; attachPdf: boolean }

/**
 * Envoie un devis ou une facture par e-mail : message + lien public + PDF en pièce jointe. Chaque tentative est journalisée ;
 * en cas de succès le document porte la date d'envoi (et un devis brouillon passe « envoyé »).
 */
export async function sendSalesDocument(ctx: Ctx, input: SendInput) {
  const docType = DOC_TYPE[input.kind];
  let number: string;
  let draftQuote = false;
  if (input.kind === "quote") {
    const q = await getQuote(ctx, input.id);
    if (q.status === "CONVERTED") throw businessRule("Ce devis a déjà été converti : envoyez plutôt la commande ou la facture.");
    if (q.status === "REJECTED") throw businessRule("Ce devis a été refusé : rouvrez-le (statut brouillon) avant de le renvoyer.");
    if (effectiveQuoteStatus(q) === "EXPIRED") throw businessRule("Ce devis est expiré : prolongez sa validité (modifiez-le) avant de l'envoyer.");
    number = q.number;
    draftQuote = q.status === "DRAFT";
  } else {
    const i = await getInvoice(ctx, input.id);
    if (i.status === "DRAFT" || i.status === "CANCELLED") throw businessRule(i.status === "DRAFT" ? "Émettez la facture avant de l'envoyer." : "Cette facture est annulée.");
    number = i.number ?? "";
  }

  const link = await ensureShareLink(ctx, docType, input.id);
  const pdf = input.attachPdf ? await buildPdf(ctx, input.kind, input.id) : null;
  const company = ctx.company.tradeName ?? ctx.company.legalName;
  const companyRow = await ctx.db.company.findFirst({ where: { id: ctx.company.id }, select: { email: true } });
  const action = input.kind === "quote" ? "Consulter et répondre au devis" : "Consulter la facture";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0b1f44;max-width:560px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#51607a;margin:0 0 16px">${esc(company)}</p>
<div style="font-size:15px;line-height:1.55">${esc(input.message).replace(/\n/g, "<br>")}</div>
<p style="margin:28px 0"><a href="${esc(link.url)}" style="background:#ea580c;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px;display:inline-block">${action}</a></p>
<p style="font-size:12px;color:#51607a;margin:0">Si le bouton ne fonctionne pas, copiez ce lien : <br>${esc(link.url)}</p>
</div>`;

  const log = (status: "SENT" | "FAILED", error?: string) => ctx.db.documentDispatch.create({ data: { companyId: ctx.company.id, docType, docId: input.id, toEmail: input.to, subject: input.subject, status, error: error ?? null, sentById: ctx.user.id } });
  try {
    await sendMail({
      to: input.to, subject: input.subject, html, replyTo: companyRow?.email ?? undefined,
      text: `${input.message}\n\n${action} : ${link.url}`,
      ...(pdf ? { attachments: [{ filename: pdf.filename, content: pdf.data }] } : {}),
    });
  } catch (e) {
    await log("FAILED", e instanceof Error ? e.message.slice(0, 300) : "Échec d'envoi");
    throw businessRule("L'e-mail n'a pas pu être envoyé. Vérifiez l'adresse du destinataire et réessayez ; la tentative est enregistrée dans l'historique.");
  }
  await log("SENT");
  const now = new Date();
  if (input.kind === "quote") await ctx.db.quote.update({ where: { id: input.id }, data: { sentAt: now, ...(draftQuote ? { status: "SENT" as const } : {}) } });
  else await ctx.db.invoice.update({ where: { id: input.id }, data: { sentAt: now } });
  await audit(ctx, { action: `${input.kind}.send`, resource: input.kind === "quote" ? "Quote" : "Invoice", resourceId: input.id, summary: `${ctx.user.name} a envoyé ${input.kind === "quote" ? "le devis" : "la facture"} ${number} à ${input.to}.` });
  return { url: link.url, sentAt: now };
}

export async function listDispatches(ctx: Ctx, kind: SendableKind, id: string, take = 10) {
  return ctx.db.documentDispatch.findMany({ where: { docType: DOC_TYPE[kind], docId: id }, orderBy: { sentAt: "desc" }, take });
}

