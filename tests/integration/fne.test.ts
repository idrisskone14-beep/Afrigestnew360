import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as crm from "@/modules/crm/service";
import { customerSchema } from "@/modules/crm/schemas";
import { fneSettingsSchema } from "@/modules/sales/fne/schemas";
import { certifyCreditNote, certifyInvoice, fneSettingsView, saveFneSettings } from "@/modules/sales/fne/service";
import * as invoices from "@/modules/sales/invoices";
import { creditNoteSchema, invoiceSchema, type LineInput } from "@/modules/sales/schemas";
import { buildPdf } from "@/modules/sales/pdf";
import { ctxFor, makeCompany } from "../helpers";

const API_KEY = "kAF01gEM40r1Uz5WLJn5lxAnGMwVjCME";
const today = () => new Date().toISOString().slice(0, 10);

/** Plateforme FNE simulée : `mode` choisit la réponse à la prochaine requête. */
let mode: "ok" | "reject" | "down" = "ok";
const calls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
let seq = 0;

function fakeFne() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, auth: (init.headers as Record<string, string>).Authorization!, body });
    if (mode === "down") throw new TypeError("fetch failed");
    if (mode === "reject") return Response.json({ message: "Point of sale is not valid", error: "bad_request", statusCode: 400 }, { status: 400 });
    seq += 1;
    const token = `http://54.247.95.108/fr/verification/tok-${seq}`;
    if (url.endsWith("/refund")) return Response.json({ ncc: "9606123E", reference: `A9606123E25${String(seq).padStart(8, "0")}`, token, warning: false, balance_sticker: 100 - seq }, { status: 201 });
    const items = (body.items as Record<string, unknown>[]).map((it, i) => ({ id: `item-${seq}-${i}`, description: it.description, quantity: it.quantity }));
    return Response.json({ ncc: "9606123E", reference: `9606123E25${String(seq).padStart(9, "0")}`, token, warning: seq > 97, balance_sticker: 100 - seq, invoice: { id: `fne-inv-${seq}`, items } });
  }));
}

async function setup(opts: { enable?: boolean; auto?: boolean } = {}) {
  const co = await makeCompany("FNE");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "KPMG Côte d'Ivoire", email: "info@kpmg.ci", phone: "07 09 08 07 65", taxId: "9502363N", country: "CI", paymentTermsDays: 30 }));
  if (opts.enable !== false) {
    await saveFneSettings(ctx, fneSettingsSchema.parse({ enabled: true, environment: "test", apiKey: API_KEY, pointOfSale: "23", establishment: "Siège Plateau", autoCertify: opts.auto ?? true, exemptTaxCode: "TVAD" }));
  }
  const line = (over: Partial<LineInput> = {}): LineInput => ({ description: "Ciment 50 kg", unit: "sac", quantity: 10, unitPrice: 6500, discountPct: 5, taxId: tax.id, ...over });
  const issue = async (lines: LineInput[] = [line(), line({ description: "Fer à béton", quantity: 4, unitPrice: 12000, discountPct: 0 })], over: Record<string, unknown> = {}) => {
    const draft = await invoices.createInvoice(ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: today(), lines }));
    return invoices.issueInvoice(ctx, { id: draft.id, installments: 1, allowOverLimit: false, ...over });
  };
  return { ...co, ctx, tax, customer, line, issue };
}

describe("facture normalisée électronique (FNE)", () => {
  beforeEach(() => { mode = "ok"; calls.length = 0; fakeFne(); });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.FNE_PROD_URL; });

  it("réglages : clé API chiffrée en base, jamais renvoyée ; activation refusée sans clé ni URL de production", async () => {
    const s = await setup();
    const row = await s.ctx.db.fneSettings.findFirstOrThrow();
    expect(row.apiKeyEnc).toBeTruthy();
    expect(row.apiKeyEnc).not.toContain(API_KEY);
    expect(row.apiKeyHint).toBe("VjCME".slice(-4));
    const view = await fneSettingsView(s.ctx);
    expect(JSON.stringify(view)).not.toContain(API_KEY);
    expect(view).toMatchObject({ enabled: true, hasKey: true, environment: "test" });

    // clé vide = conservée
    await saveFneSettings(s.ctx, fneSettingsSchema.parse({ enabled: true, environment: "test", apiKey: "", pointOfSale: "24", establishment: "Siège", autoCertify: true, exemptTaxCode: "TVAC" }));
    expect((await s.ctx.db.fneSettings.findFirstOrThrow()).apiKeyEnc).toBe(row.apiKeyEnc);

    await expect(saveFneSettings(s.ctx, fneSettingsSchema.parse({ enabled: true, environment: "production", apiKey: "", pointOfSale: "24", establishment: "Siège", autoCertify: true, exemptTaxCode: "TVAD" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("FNE_PROD_URL") });
    const other = await setup({ enable: false });
    await expect(saveFneSettings(other.ctx, fneSettingsSchema.parse({ enabled: true, environment: "test", apiKey: "", pointOfSale: "1", establishment: "x", autoCertify: true, exemptTaxCode: "TVAD" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("clé API") });
    // isolation : l'autre entreprise ne voit pas les réglages de la première
    expect(await other.ctx.db.fneSettings.findFirst()).toBeNull();
  });

  it("émission : la facture est certifiée automatiquement (numéro, QR, articles) et le PDF porte le cadre FNE", async () => {
    const s = await setup();
    const inv = await s.issue();
    expect(inv.fne).toMatchObject({ status: "CERTIFIED", reference: expect.stringMatching(/^9606123E25/) });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://54.247.95.108/ws/external/invoices/sign");
    expect(calls[0]!.auth).toBe(`Bearer ${API_KEY}`);
    expect(calls[0]!.body).toMatchObject({ invoiceType: "sale", template: "B2B", clientNcc: "9502363N", paymentMethod: "deferred", pointOfSale: "23", establishment: "Siège Plateau", clientPhone: "0709080765" });
    expect(calls[0]!.body.items).toEqual([
      { taxes: ["TVA"], description: "Ciment 50 kg", quantity: 10, amount: 6500, discount: 5, measurementUnit: "sac" },
      { taxes: ["TVA"], description: "Fer à béton", quantity: 4, amount: 12000, discount: 0, measurementUnit: "sac" },
    ]);

    const row = await s.ctx.db.invoice.findFirstOrThrow({ where: { id: inv.id }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(row).toMatchObject({ status: "ISSUED", fneStatus: "CERTIFIED", fneId: expect.stringMatching(/^fne-inv-/), fneTemplate: "B2B", fnePaymentMethod: "deferred", fneError: null });
    expect(row.fneItems).toEqual(row.lines.map((l, i) => ({ lineId: l.id, fneItemId: `item-${seq}-${i}` })));
    expect((await s.ctx.db.fneSettings.findFirstOrThrow()).stickerBalance).toBe(100 - seq);

    const pdf = await buildPdf(s.ctx, "invoice", inv.id);
    expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");

    // ni seconde certification, ni annulation d'une facture certifiée
    await expect(certifyInvoice(s.ctx, inv.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("déjà certifiée") });
    await expect(invoices.cancelInvoice(s.ctx, inv.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("avoir") });
    expect(calls).toHaveLength(1);
  });

  it("refus de la FNE : la facture reste émise, l'échec est enregistré, puis la certification est relancée", async () => {
    const s = await setup();
    mode = "reject";
    const inv = await s.issue(undefined, { fneTemplate: "B2G", fnePaymentMethod: "transfer" });
    expect(inv.number).toBeTruthy();
    expect(inv.fne).toMatchObject({ status: "FAILED", message: expect.stringContaining("Point of sale is not valid") });
    expect(await s.ctx.db.invoice.findFirstOrThrow({ where: { id: inv.id } })).toMatchObject({ status: "ISSUED", fneStatus: "FAILED", fneTemplate: "B2G", fnePaymentMethod: "transfer" });

    mode = "ok";
    const again = await certifyInvoice(s.ctx, inv.id);
    expect(again.status).toBe("CERTIFIED");
    expect(calls.at(-1)!.body).toMatchObject({ template: "B2G", paymentMethod: "transfer" });
  });

  it("panne réseau : issue incertaine (UNKNOWN), annulation bloquée, nouvelle tentative possible", async () => {
    const s = await setup();
    mode = "down";
    const inv = await s.issue();
    expect(inv.fne).toMatchObject({ status: "UNKNOWN", message: expect.stringContaining("vérifiez dans votre espace FNE") });
    await expect(invoices.cancelInvoice(s.ctx, inv.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    mode = "ok";
    expect((await certifyInvoice(s.ctx, inv.id)).status).toBe("CERTIFIED");
  });

  it("données manquantes : rien n'est envoyé et le motif est enregistré sur la facture", async () => {
    const s = await setup();
    await s.ctx.db.customer.update({ where: { id: s.customer.id }, data: { phone: null } });
    const inv = await s.issue();
    expect(inv.fne).toMatchObject({ status: "FAILED", message: expect.stringContaining("téléphone du client") });
    expect(calls).toHaveLength(0);
  });

  it("avoir : certifié sur les articles FNE de la facture d'origine ; refusé si la facture n'est pas certifiée", async () => {
    const s = await setup();
    const inv = await s.issue();
    const full = await invoices.getInvoice(s.ctx, inv.id);
    const items = full.fneItems as { lineId: string; fneItemId: string }[];
    const cn = await invoices.createCreditNote(s.ctx, creditNoteSchema.parse({ invoiceId: inv.id, reason: "Retour de marchandise", lines: [{ invoiceLineId: full.lines[1]!.id, quantity: 2 }] }));
    const issued = await invoices.issueCreditNote(s.ctx, cn.id);
    expect(issued.fne).toMatchObject({ status: "CERTIFIED", reference: expect.stringMatching(/^A9606123E/) });
    expect(calls.at(-1)!.url).toBe(`http://54.247.95.108/ws/external/invoices/${full.fneId}/refund`);
    expect(calls.at(-1)!.body).toEqual({ items: [{ id: items[1]!.fneItemId, quantity: 2 }] });
    expect((await buildPdf(s.ctx, "credit-note", cn.id)).data.subarray(0, 5).toString()).toBe("%PDF-");

    // facture émise sans certification (FNE activée après coup, manuelle) : l'avoir ne peut pas être certifié
    const manual = await setup({ auto: false });
    const plain = await manual.issue();
    expect(plain.fne).toBeNull();
    const pl = await invoices.getInvoice(manual.ctx, plain.id);
    const cn2 = await invoices.createCreditNote(manual.ctx, creditNoteSchema.parse({ invoiceId: plain.id, reason: "Geste commercial", lines: [{ invoiceLineId: pl.lines[0]!.id, quantity: 1 }] }));
    await invoices.issueCreditNote(manual.ctx, cn2.id);
    const o = await certifyCreditNote(manual.ctx, cn2.id);
    expect(o).toMatchObject({ status: "FAILED", message: expect.stringContaining("n'est pas certifiée FNE") });
  });

  it("plateforme fermée (FNE_ENABLED absent) : réglages refusés, aucune certification, aucun appel à la DGI", async () => {
    const s = await setup();
    const before = calls.length;
    const saved = process.env.FNE_ENABLED;
    delete process.env.FNE_ENABLED;
    try {
      const inv = await s.issue();
      expect(inv.fne).toBeNull();
      await expect(certifyInvoice(s.ctx, inv.id)).resolves.toMatchObject({ status: "FAILED", message: expect.stringContaining("autorisation de la DGI") });
      await expect(saveFneSettings(s.ctx, fneSettingsSchema.parse({ enabled: true, environment: "test", apiKey: "", pointOfSale: "1", establishment: "x", autoCertify: true, exemptTaxCode: "TVAD" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("autorisation de la DGI") });
      expect(calls.length).toBe(before);
    } finally {
      process.env.FNE_ENABLED = saved;
    }
  });

  it("FNE inactive ou certification manuelle : l'émission n'appelle pas la plateforme", async () => {
    const off = await setup({ enable: false });
    expect((await off.issue()).fne).toBeNull();
    const manual = await setup({ auto: false });
    const inv = await manual.issue();
    expect(inv.fne).toBeNull();
    expect(calls).toHaveLength(0);
    expect((await certifyInvoice(manual.ctx, inv.id)).status).toBe("CERTIFIED");
    await expect(certifyInvoice(off.ctx, (await off.issue()).id)).resolves.toMatchObject({ status: "FAILED", message: expect.stringContaining("n'est pas activée") });
  });

  it("deux certifications simultanées de la même facture : un seul appel à la FNE", async () => {
    const s = await setup({ auto: false });
    const inv = await s.issue();
    const results = await Promise.allSettled([certifyInvoice(s.ctx, inv.id), certifyInvoice(s.ctx, inv.id)]);
    expect(results.filter((r) => r.status === "fulfilled" && r.value.status === "CERTIFIED")).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
