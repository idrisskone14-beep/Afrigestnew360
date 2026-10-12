import "server-only";
import { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { linesSchema } from "@/core/documents/line-schema";
import type { TenantContext } from "@/core/tenant/context";
import { sendSalesDocument, sendDefaults } from "./dispatch";
import { createInvoice, getInvoice, issueInvoice } from "./invoices";
import { invoiceSchema, issueInvoiceSchema } from "./schemas";

/**
 * Factures récurrentes (abonnements, loyers, maintenance). Un modèle (client + lignes) génère une facture brouillon à chaque
 * échéance — émise et envoyée automatiquement si le modèle le demande. Un échec n'avance pas le calendrier : il est consigné
 * sur le modèle et la génération est retentée au passage suivant. La génération est « réservée » par un test-et-mise-à-jour
 * de la date, ce qui interdit de produire deux fois la même échéance (tâche planifiée et clic simultanés).
 */
type Ctx = TenantContext;
type Frequency = "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "YEARLY";
const STEP: Record<Frequency, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, YEARLY: 12 };
export const FREQUENCY_LABEL: Record<Frequency, string> = { MONTHLY: "Chaque mois", QUARTERLY: "Chaque trimestre", SEMIANNUAL: "Chaque semestre", YEARLY: "Chaque année" };
export const MAX_CATCH_UP = 12;

const uuid = z.string().uuid();
const optDate = z.string().optional().or(z.literal(""));
const FREQ = z.enum(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "YEARLY"]);

const settings = {
  title: z.string().trim().min(2, "Donnez un nom au modèle").max(120),
  frequency: FREQ,
  nextRunDate: z.string().min(8, "Date requise"),
  endDate: optDate,
  autoIssue: z.boolean().default(false),
  autoSend: z.boolean().default(false),
};
export const recurringFromInvoiceSchema = z.object({ invoiceId: uuid, ...settings });
export const updateRecurringSchema = z.object({ id: uuid, ...settings });
export const recurringStatusSchema = z.object({ id: uuid, status: z.enum(["ACTIVE", "PAUSED"]) });

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (s: string | Date) => { const d = typeof s === "string" ? new Date(`${s.slice(0, 10)}T00:00:00.000Z`) : d0(s); return d; };
const d0 = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Date de l'occurrence suivante : même jour du mois (`anchorDay`), ramené à la fin des mois plus courts. */
export function nextOccurrence(from: Date, frequency: Frequency, anchorDay: number): Date {
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + STEP[frequency];
  const year = Math.floor(total / 12), month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(Math.max(1, anchorDay), last)));
}

async function assertCustomer(ctx: Ctx, customerId: string) {
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!c) throw notFound("Client");
  if (!c.isActive) throw businessRule("Ce client est inactif.");
  return c;
}

export async function listRecurring(ctx: Ctx) {
  return ctx.db.recurringInvoice.findMany({ orderBy: [{ status: "asc" }, { nextRunDate: "asc" }], include: { customer: { select: { id: true, name: true, email: true } }, _count: { select: { invoices: true } } }, take: 500 });
}

export async function getRecurring(ctx: Ctx, id: string) {
  const r = await ctx.db.recurringInvoice.findFirst({ where: { id }, include: { customer: true } });
  if (!r) throw notFound("Modèle de facture récurrente");
  return r;
}

type TemplateLine = z.output<typeof linesSchema>[number];

/** Crée un modèle à partir d'une facture existante : mêmes lignes (hors déductions d'acompte), même client. */
export async function createRecurringFromInvoice(ctx: Ctx, input: z.output<typeof recurringFromInvoiceSchema>) {
  const inv = await getInvoice(ctx, input.invoiceId);
  if (inv.status === "CANCELLED") throw businessRule("Cette facture est annulée.");
  if (inv.kind === "DEPOSIT") throw businessRule("Une facture d'acompte ne peut pas devenir récurrente.");
  await assertCustomer(ctx, inv.customerId);
  const lines: TemplateLine[] = inv.lines.filter((l) => Number(l.quantity) > 0).map((l) => ({
    productId: l.productId ?? "", description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct), taxId: l.taxId ?? "",
  }));
  if (lines.length === 0) throw businessRule("Cette facture n'a aucune ligne à répéter.");
  const next = utcDay(input.nextRunDate);
  const end = input.endDate ? utcDay(input.endDate) : null;
  if (end && end < next) throw businessRule("La date de fin précède la première échéance.");
  const rec = await ctx.db.recurringInvoice.create({
    data: {
      companyId: ctx.company.id, title: input.title, customerId: inv.customerId, frequency: input.frequency, nextRunDate: next, anchorDay: next.getUTCDate(), endDate: end,
      autoIssue: input.autoIssue, autoSend: input.autoSend && input.autoIssue, notes: inv.notes, terms: inv.terms, lines, branchId: inv.branchId, costCenterId: inv.costCenterId, projectId: inv.projectId, createdById: ctx.user.id,
    },
  });
  await audit(ctx, { action: "recurring.create", resource: "RecurringInvoice", resourceId: rec.id, summary: `${ctx.user.name} a créé le modèle de facture récurrente « ${rec.title} » (${FREQUENCY_LABEL[rec.frequency].toLowerCase()}).`, after: { frequency: rec.frequency, nextRunDate: dayKey(next) } });
  return rec;
}

export async function updateRecurring(ctx: Ctx, input: z.output<typeof updateRecurringSchema>) {
  const before = await getRecurring(ctx, input.id);
  if (before.status === "ENDED") throw businessRule("Ce modèle est terminé : créez-en un nouveau depuis une facture.");
  const next = utcDay(input.nextRunDate);
  const end = input.endDate ? utcDay(input.endDate) : null;
  if (end && end < next) throw businessRule("La date de fin précède la prochaine échéance.");
  const rec = await ctx.db.recurringInvoice.update({
    where: { id: input.id },
    data: { title: input.title, frequency: input.frequency, nextRunDate: next, anchorDay: next.getUTCDate(), endDate: end, autoIssue: input.autoIssue, autoSend: input.autoSend && input.autoIssue },
  });
  await audit(ctx, { action: "recurring.update", resource: "RecurringInvoice", resourceId: rec.id, summary: `${ctx.user.name} a modifié le modèle récurrent « ${rec.title} ».`, before: { frequency: before.frequency, nextRunDate: dayKey(before.nextRunDate) }, after: { frequency: rec.frequency, nextRunDate: dayKey(rec.nextRunDate) } });
  return rec;
}

export async function setRecurringStatus(ctx: Ctx, input: z.output<typeof recurringStatusSchema>) {
  const rec = await getRecurring(ctx, input.id);
  if (rec.status === "ENDED") throw businessRule("Ce modèle est terminé.");
  await ctx.db.recurringInvoice.update({ where: { id: rec.id }, data: { status: input.status, ...(input.status === "ACTIVE" ? { lastError: null } : {}) } });
  await audit(ctx, { action: "recurring.status", resource: "RecurringInvoice", resourceId: rec.id, summary: `${ctx.user.name} a ${input.status === "PAUSED" ? "mis en pause" : "réactivé"} le modèle récurrent « ${rec.title} ».` });
}

export async function deleteRecurring(ctx: Ctx, id: string) {
  const rec = await getRecurring(ctx, id);
  await ctx.db.recurringInvoice.delete({ where: { id } }); // les factures déjà générées restent (lien mis à vide)
  await audit(ctx, { action: "recurring.delete", resource: "RecurringInvoice", resourceId: id, summary: `${ctx.user.name} a supprimé le modèle récurrent « ${rec.title} ».` });
}

type Rec = Awaited<ReturnType<typeof getRecurring>>;

/** Génère UNE facture à partir du modèle, datée de `issueDate`. Émise et envoyée si le modèle le demande. */
async function generate(ctx: Ctx, rec: Rec, issueDate: Date) {
  const customer = await assertCustomer(ctx, rec.customerId);
  const input = invoiceSchema.parse({
    customerId: rec.customerId, issueDate: dayKey(issueDate), dueDate: "", notes: rec.notes ?? "", terms: rec.terms ?? "", lines: rec.lines,
    branchId: rec.branchId ?? "", costCenterId: rec.costCenterId ?? "", projectId: rec.projectId ?? "",
  });
  const draft = await createInvoice(ctx, input);
  await ctx.db.invoice.update({ where: { id: draft.id }, data: { recurringId: rec.id } });
  if (!rec.autoIssue) return { invoiceId: draft.id, issued: false, sent: false, warning: null as string | null };
  await issueInvoice(ctx, issueInvoiceSchema.parse({ id: draft.id, installments: 1 }));
  if (!rec.autoSend) return { invoiceId: draft.id, issued: true, sent: false, warning: null };
  if (!customer.email) return { invoiceId: draft.id, issued: true, sent: false, warning: "Facture émise mais non envoyée : le client n'a pas d'adresse e-mail." };
  try {
    const defaults = await sendDefaults(ctx, "invoice", draft.id);
    await sendSalesDocument(ctx, { kind: "invoice", id: draft.id, to: customer.email, subject: defaults.subject, message: defaults.message, attachPdf: true });
    return { invoiceId: draft.id, issued: true, sent: true, warning: null };
  } catch (e) {
    return { invoiceId: draft.id, issued: true, sent: false, warning: `Facture émise mais l'envoi a échoué : ${e instanceof Error ? e.message : "erreur"}` };
  }
}

export interface RunResult { generated: number; invoiceIds: string[]; error: string | null; warnings: string[] }

/**
 * Génère les factures échues d'un modèle (jusqu'à `MAX_CATCH_UP` à la suite si des échéances ont été manquées) puis avance le calendrier.
 * `manual` : génère l'occurrence prévue maintenant (facture datée d'aujourd'hui), même si elle n'est pas encore échue.
 */
export async function runRecurring(ctx: Ctx, id: string, opts: { today?: Date; manual?: boolean } = {}): Promise<RunResult> {
  const today = d0(opts.today ?? new Date());
  const result: RunResult = { generated: 0, invoiceIds: [], error: null, warnings: [] };
  for (let n = 0; n < (opts.manual ? 1 : MAX_CATCH_UP); n++) {
    const rec = await getRecurring(ctx, id);
    if (rec.status !== "ACTIVE") break;
    const scheduled = d0(rec.nextRunDate);
    if (!opts.manual && scheduled > today) break;
    if (rec.endDate && scheduled > d0(rec.endDate)) { await ctx.db.recurringInvoice.update({ where: { id }, data: { status: "ENDED" } }); break; }

    const upcoming = nextOccurrence(scheduled, rec.frequency, rec.anchorDay);
    const ended = rec.endDate !== null && upcoming > d0(rec.endDate);
    // réservation : seul l'appelant qui avance la date génère l'échéance
    const claim = await ctx.db.recurringInvoice.updateMany({ where: { id, status: "ACTIVE", nextRunDate: rec.nextRunDate }, data: { nextRunDate: upcoming, ...(ended ? { status: "ENDED" as const } : {}) } });
    if (claim.count !== 1) break;
    try {
      const out = await generate(ctx, rec, opts.manual ? today : scheduled);
      result.generated++; result.invoiceIds.push(out.invoiceId);
      if (out.warning) result.warnings.push(out.warning);
      await ctx.db.recurringInvoice.update({ where: { id }, data: { runCount: { increment: 1 }, lastRunAt: new Date(), lastError: out.warning } });
      await audit(ctx, { action: "recurring.generate", resource: "RecurringInvoice", resourceId: id, summary: `Facture récurrente « ${rec.title} » générée${out.issued ? " et émise" : " (brouillon)"}${out.sent ? ", envoyée au client" : ""}.`, after: { invoiceId: out.invoiceId } });
    } catch (e) {
      // la génération a échoué : le calendrier reprend où il en était, l'erreur est visible sur le modèle
      const message = e instanceof Error ? e.message.slice(0, 300) : "Erreur inconnue";
      await ctx.db.recurringInvoice.updateMany({ where: { id }, data: { nextRunDate: rec.nextRunDate, status: "ACTIVE", lastError: message } });
      result.error = message;
      break;
    }
  }
  return result;
}
