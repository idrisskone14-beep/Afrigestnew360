import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as crm from "@/modules/crm/service";
import { customerSchema } from "@/modules/crm/schemas";
import { sendSalesDocument } from "@/modules/sales/dispatch";
import * as invoices from "@/modules/sales/invoices";
import { loadSharedDocument, respondSchema, respondToSharedQuote } from "@/modules/sales/public-share";
import * as quotes from "@/modules/sales/quotes";
import { invoiceSchema, issueInvoiceSchema, quoteSchema, type LineInput } from "@/modules/sales/schemas";
import { ensureShareLink, revokeShareLink, resolveShare } from "@/core/share/service";
import { makeCompany, ctxFor } from "../helpers";

const sent: { to: string; subject: string; text: string; attachments?: { filename: string }[] }[] = [];
let failNext = false;
vi.mock("@/core/mail", async (orig) => ({
  ...(await orig<typeof import("@/core/mail")>()),
  sendMail: async (m: (typeof sent)[number]) => {
    if (failNext) { failNext = false; throw new Error("boom"); }
    sent.push(m);
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }), cookies: async () => ({ get: () => undefined }) }));

const today = () => new Date().toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("PARTAGE");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Client Partage", email: "client@partage.ci", paymentTermsDays: 30 }));
  const line: LineInput = { productId: "", description: "Prestation", unit: "forfait", quantity: 2, unitPrice: 50000, discountPct: 0, taxId: tax.id };
  const newQuote = (over = {}) => quotes.createQuote(ctx, quoteSchema.parse({ kind: "QUOTE", customerId: customer.id, issueDate: today(), validUntil: "", notes: "", terms: "", lines: [line], ...over }));
  const newInvoice = async (issue = true) => {
    const i = await invoices.createInvoice(ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: today(), dueDate: "", notes: "", terms: "", lines: [line] }));
    return issue ? invoices.issueInvoice(ctx, issueInvoiceSchema.parse({ id: i.id })) : i;
  };
  return { ...co, ctx, customer, newQuote, newInvoice };
}

const send = (s: Awaited<ReturnType<typeof setup>>, kind: "quote" | "invoice", id: string) => sendSalesDocument(s.ctx, { kind, id, to: "client@partage.ci", subject: "Objet de test", message: "Bonjour, voici le document.", attachPdf: true });

beforeEach(() => { sent.length = 0; failNext = false; });

describe("envoi par e-mail", () => {
  it("envoie un devis avec le lien public et le PDF, le passe « envoyé » et journalise l'envoi", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const r = await send(s, "quote", q.id);
    expect(r.url).toMatch(/\/p\/[A-Za-z0-9_-]{32}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("client@partage.ci");
    expect(sent[0]!.text).toContain(r.url);
    expect(sent[0]!.attachments?.[0]?.filename).toBe(`${q.number}.pdf`);
    const after = await quotes.getQuote(s.ctx, q.id);
    expect(after.status).toBe("SENT");
    expect(after.sentAt).not.toBeNull();
    const log = await s.ctx.db.documentDispatch.findMany({ where: { docId: q.id } });
    expect(log).toHaveLength(1);
    expect(log[0]!.status).toBe("SENT");
  });

  it("réutilise le même lien à chaque envoi", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const a = await send(s, "quote", q.id);
    const b = await send(s, "quote", q.id);
    expect(b.url).toBe(a.url);
  });

  it("un échec d'envoi est journalisé sans changer le devis", async () => {
    const s = await setup();
    const q = await s.newQuote();
    failNext = true;
    await expect(send(s, "quote", q.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const after = await quotes.getQuote(s.ctx, q.id);
    expect(after.status).toBe("DRAFT");
    expect(after.sentAt).toBeNull();
    expect((await s.ctx.db.documentDispatch.findMany({ where: { docId: q.id } })).map((l) => l.status)).toEqual(["FAILED"]);
  });

  it("refuse d'envoyer un devis refusé ou converti, et une facture brouillon", async () => {
    const s = await setup();
    const rejected = await s.newQuote();
    await quotes.setQuoteStatus(s.ctx, { id: rejected.id, status: "REJECTED" });
    await expect(send(s, "quote", rejected.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const draft = await s.newInvoice(false);
    await expect(send(s, "invoice", draft.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(sent).toHaveLength(0);
  });

  it("envoie une facture émise et enregistre la date d'envoi", async () => {
    const s = await setup();
    const i = await s.newInvoice();
    await send(s, "invoice", i.id);
    expect((await invoices.getInvoice(s.ctx, i.id)).sentAt).not.toBeNull();
    expect(sent[0]!.attachments?.[0]?.filename).toBe(`${i.number}.pdf`);
  });
});

describe("lien public", () => {
  it("affiche le devis sans session, compte la consultation et ignore les secrets invalides", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const { token } = await ensureShareLink(s.ctx, "QUOTE", q.id);
    const doc = await loadSharedDocument(token);
    expect(doc?.kind).toBe("QUOTE");
    expect(doc?.number).toBe(q.number);
    expect(doc?.preview.lines).toHaveLength(1);
    expect(await loadSharedDocument("pas-un-secret")).toBeNull();
    expect(await loadSharedDocument("A".repeat(32))).toBeNull();
    const link = await platformDb.shareLink.findUniqueOrThrow({ where: { token } });
    expect(link.viewCount).toBe(1);
  });

  it("un lien révoqué ne donne plus rien, et un nouveau lien remplace l'ancien", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const { token } = await ensureShareLink(s.ctx, "QUOTE", q.id);
    await revokeShareLink(s.ctx, "QUOTE", q.id);
    expect(await resolveShare(token)).toBeNull();
    const fresh = await ensureShareLink(s.ctx, "QUOTE", q.id);
    expect(fresh.token).not.toBe(token);
    expect(await resolveShare(fresh.token)).not.toBeNull();
    expect(await resolveShare(token)).toBeNull();
  });

  it("une facture brouillon n'est pas consultable ; une facture émise l'est, avec son reste dû", async () => {
    const s = await setup();
    const draft = await s.newInvoice(false);
    const { token: t1 } = await ensureShareLink(s.ctx, "INVOICE", draft.id);
    expect(await loadSharedDocument(t1)).toBeNull();
    const issued = await s.newInvoice();
    const { token: t2 } = await ensureShareLink(s.ctx, "INVOICE", issued.id);
    const doc = await loadSharedDocument(t2);
    expect(doc?.kind).toBe("INVOICE");
    expect(doc?.balance).toBe(118000);
    expect(doc?.canRespond).toBe(false);
  });

  it("le lien d'une entreprise suspendue est inutilisable", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const { token } = await ensureShareLink(s.ctx, "QUOTE", q.id);
    await platformDb.company.update({ where: { id: s.company.id }, data: { status: "SUSPENDED" } });
    expect(await loadSharedDocument(token)).toBeNull();
  });
});

describe("réponse du client à un devis", () => {
  const answer = (token: string, over: Partial<Parameters<typeof respondSchema.parse>[0]> = {}) => respondToSharedQuote(respondSchema.parse({ token, decision: "ACCEPT", name: "Awa Koné", note: "Bon pour accord", ...over }));

  it("accepte le devis en ligne : statut, nom, commentaire, journal d'audit et notification", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const { url } = await send(s, "quote", q.id);
    const token = url.split("/p/")[1]!;
    expect((await loadSharedDocument(token))?.canRespond).toBe(true);
    const r = await answer(token);
    expect(r.accepted).toBe(true);
    const after = await quotes.getQuote(s.ctx, q.id);
    expect(after.status).toBe("ACCEPTED");
    expect(after.respondedByName).toBe("Awa Koné");
    expect(after.responseNote).toBe("Bon pour accord");
    expect(after.respondedAt).not.toBeNull();
    const audit = await s.ctx.db.auditLog.findFirst({ where: { resourceId: q.id, action: "quote.accepted_online" } });
    expect(audit?.userId).toBeNull();
    expect(audit?.ip).toBe("203.0.113.9");
    expect(await s.ctx.db.notification.count({ where: { type: "quote.responded", userId: s.owner.id } })).toBe(1);
    expect((await loadSharedDocument(token))?.canRespond).toBe(false);
  });

  it("refuse le devis en ligne", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const token = (await send(s, "quote", q.id)).url.split("/p/")[1]!;
    await answer(token, { decision: "REJECT", note: "Trop cher" });
    const after = await quotes.getQuote(s.ctx, q.id);
    expect(after.status).toBe("REJECTED");
    expect(after.responseNote).toBe("Trop cher");
  });

  it("n'accepte qu'une réponse, et seulement pour un devis envoyé et valide", async () => {
    const s = await setup();
    const q = await s.newQuote();
    const token = (await send(s, "quote", q.id)).url.split("/p/")[1]!;
    await answer(token);
    await expect(answer(token, { decision: "REJECT" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const draft = await s.newQuote();
    const { token: draftToken } = await ensureShareLink(s.ctx, "QUOTE", draft.id);
    await expect(answer(draftToken)).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const old = await s.newQuote({ issueDate: "2020-01-01", validUntil: "2020-02-01" });
    const oldToken = (await ensureShareLink(s.ctx, "QUOTE", old.id)).token;
    await s.ctx.db.quote.update({ where: { id: old.id }, data: { status: "SENT" } });
    await expect(answer(oldToken)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("refuse un nom trop court et un secret inconnu", async () => {
    expect(() => respondSchema.parse({ token: "x".repeat(32), decision: "ACCEPT", name: "A" })).toThrow();
    await expect(answer("B".repeat(32))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
