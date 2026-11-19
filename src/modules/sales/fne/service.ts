import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { decryptSecret, encryptSecret } from "@/core/auth/crypto";
import { AppError, businessRule, notFound } from "@/core/errors";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import {
  buildSalePayload, defaultFneTemplate, fneBaseUrl, fneFeatureEnabled, FneCallError, FneInputError, matchFneItems, signRefund, signSaleInvoice,
  type FneCertification, type FneConnection, type FneEnvironment, type FneExemptCode, type FnePaymentMethod, type FneTemplate,
} from "./client";
import type { fneSettingsSchema } from "./schemas";

type Ctx = TenantContext;

/** Résultat d'une tentative de certification (jamais d'exception pour un refus ou une panne de la FNE). */
export type FneOutcome = { status: "CERTIFIED"; reference: string; stickerWarning: boolean } | { status: "FAILED" | "UNKNOWN"; message: string };

/** Délai après lequel une certification restée « en cours » (processus interrompu) peut être relancée. */
const STALE_PENDING_MS = 2 * 60_000;

const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

// ── Réglages ──────────────────────────────────────────────────

export const getFneSettings = (ctx: Pick<Ctx, "db">) => ctx.db.fneSettings.findFirst();

/** Réglages présentables au navigateur : la clé API n'en sort jamais (seuls ses 4 derniers caractères). */
export async function fneSettingsView(ctx: Ctx) {
  const s = await getFneSettings(ctx);
  return {
    enabled: s?.enabled ?? false,
    environment: (s?.environment ?? "test") as FneEnvironment,
    hasKey: Boolean(s?.apiKeyEnc),
    apiKeyHint: s?.apiKeyHint ?? null,
    pointOfSale: s?.pointOfSale ?? "",
    establishment: s?.establishment ?? "",
    commercialMessage: s?.commercialMessage ?? "",
    footer: s?.footer ?? "",
    autoCertify: s?.autoCertify ?? true,
    exemptTaxCode: (s?.exemptTaxCode ?? "TVAD") as FneExemptCode,
    stickerBalance: s?.stickerBalance ?? null,
    stickerWarning: s?.stickerWarning ?? false,
    stickerCheckedAt: s?.stickerCheckedAt ?? null,
    prodUrlConfigured: fneBaseUrl("production") !== null,
    currencyOk: ctx.company.currency === "XOF",
  };
}

const NOT_OPEN = "La certification FNE n'est pas encore ouverte sur la plateforme (autorisation de la DGI en attente).";

export async function saveFneSettings(ctx: Ctx, input: z.output<typeof fneSettingsSchema>) {
  if (!fneFeatureEnabled()) throw businessRule(NOT_OPEN);
  const before = await getFneSettings(ctx);
  const newKey = blank(input.apiKey);
  const hasKey = Boolean(newKey || before?.apiKeyEnc);
  if (input.enabled) {
    if (ctx.company.currency !== "XOF") throw businessRule("La FNE ne certifie que des factures en francs CFA (XOF) : la devise de l'entreprise ne convient pas.");
    if (!hasKey) throw businessRule("Renseignez la clé API de votre espace FNE (onglet « Paramétrage ») pour activer la certification.");
    if (!blank(input.pointOfSale) || !blank(input.establishment)) throw businessRule("Le point de vente et l'établissement sont exigés par la FNE.");
    if (input.environment === "production" && !fneBaseUrl("production")) {
      throw businessRule("L'URL de production FNE n'est pas configurée sur la plateforme (variable FNE_PROD_URL) : restez en environnement de test.");
    }
  }
  const data = {
    enabled: input.enabled, environment: input.environment, pointOfSale: blank(input.pointOfSale), establishment: blank(input.establishment),
    commercialMessage: blank(input.commercialMessage), footer: blank(input.footer), autoCertify: input.autoCertify, exemptTaxCode: input.exemptTaxCode,
    ...(newKey ? { apiKeyEnc: encryptSecret(newKey), apiKeyHint: newKey.slice(-4) } : {}),
  };
  const after = await ctx.db.fneSettings.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, ...data }, update: data });
  const safe = (s: typeof after | null) => (s ? { enabled: s.enabled, environment: s.environment, pointOfSale: s.pointOfSale, establishment: s.establishment, autoCertify: s.autoCertify, exemptTaxCode: s.exemptTaxCode, apiKeyHint: s.apiKeyHint } : null);
  await audit(ctx, {
    action: "fne.settings.update", resource: "FneSettings", resourceId: after.id,
    summary: `${ctx.user.name} a modifié le raccordement FNE (${after.enabled ? `actif, ${after.environment === "production" ? "production" : "test"}` : "inactif"}${newKey ? ", nouvelle clé API" : ""}).`,
    before: safe(before), after: safe(after),
  });
  return after;
}

async function connection(ctx: Ctx): Promise<{ conn: FneConnection; settings: NonNullable<Awaited<ReturnType<typeof getFneSettings>>> }> {
  if (!fneFeatureEnabled()) throw businessRule(NOT_OPEN);
  const settings = await getFneSettings(ctx);
  if (!settings?.enabled) throw businessRule("La certification FNE n'est pas activée (Paramètres → FNE).");
  if (!settings.apiKeyEnc) throw businessRule("Clé API FNE absente (Paramètres → FNE).");
  const baseUrl = fneBaseUrl(settings.environment === "production" ? "production" : "test");
  if (!baseUrl) throw businessRule("L'URL de production FNE n'est pas configurée sur la plateforme (FNE_PROD_URL).");
  let apiKey: string;
  try {
    apiKey = decryptSecret(settings.apiKeyEnc);
  } catch {
    throw businessRule("La clé API FNE enregistrée est illisible : saisissez-la de nouveau (Paramètres → FNE).");
  }
  return { conn: { baseUrl, apiKey }, settings };
}

/** La certification automatique à l'émission est-elle active pour cette entreprise ? */
export async function fneAutoCertify(ctx: Ctx): Promise<boolean> {
  if (!fneFeatureEnabled()) return false;
  const s = await getFneSettings(ctx);
  return Boolean(s?.enabled && s.autoCertify);
}

async function recordSticker(ctx: Ctx, cert: FneCertification) {
  await ctx.db.fneSettings.update({ where: { companyId: ctx.company.id }, data: { stickerBalance: cert.stickerBalance, stickerWarning: cert.stickerWarning, stickerCheckedAt: new Date() } });
}

const claimable = () => ({ OR: [{ fneStatus: null }, { fneStatus: { in: ["FAILED", "UNKNOWN"] as ("FAILED" | "UNKNOWN")[] } }, { fneStatus: "PENDING" as const, fneAttemptAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } }] });

function failure(e: unknown): { status: "FAILED" | "UNKNOWN"; message: string } {
  if (e instanceof FneCallError) {
    return e.outcome === "rejected"
      ? { status: "FAILED", message: e.message }
      : { status: "UNKNOWN", message: `${e.message} La facture a pu être certifiée malgré tout : vérifiez dans votre espace FNE avant de réessayer, pour éviter un doublon.` };
  }
  if (e instanceof FneInputError || e instanceof AppError) return { status: "FAILED", message: e.message };
  return { status: "UNKNOWN", message: "Erreur inattendue pendant la certification FNE : vérifiez dans votre espace FNE avant de réessayer." };
}

// ── Factures ──────────────────────────────────────────────────

/**
 * Certifie une facture émise auprès de la FNE. L'état (en cours, certifiée, échec, incertain) est enregistré sur la facture ;
 * une certification déjà acquise ou en cours n'est jamais relancée (pas de double certification).
 * Lève une erreur métier si la facture ne s'y prête pas ; renvoie l'issue de l'appel sinon.
 */
export async function certifyInvoice(ctx: Ctx, id: string, opts: { template?: FneTemplate; paymentMethod?: FnePaymentMethod } = {}): Promise<FneOutcome> {
  const inv = await ctx.db.invoice.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, customer: true } });
  if (!inv) throw notFound("Facture");
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") throw businessRule("Seule une facture émise peut être certifiée FNE.");
  if (inv.fneStatus === "CERTIFIED") throw businessRule(`Cette facture est déjà certifiée FNE (${inv.fneReference}).`);

  const template = opts.template ?? (inv.fneTemplate as FneTemplate | null) ?? defaultFneTemplate(inv.customer, ctx.company.country);
  const paymentMethod = opts.paymentMethod ?? (inv.fnePaymentMethod as FnePaymentMethod | null) ?? "deferred";

  const saveFailure = async (f: { status: "FAILED" | "UNKNOWN"; message: string }) => {
    await ctx.db.invoice.update({ where: { id }, data: { fneStatus: f.status, fneError: f.message.slice(0, 1000), fneTemplate: template, fnePaymentMethod: paymentMethod } });
    await audit(ctx, { action: "invoice.fne_failed", resource: "Invoice", resourceId: id, summary: `Certification FNE de la facture ${inv.number} non aboutie : ${f.message}` });
    return f;
  };

  let conn: FneConnection;
  let payload: Record<string, unknown>;
  let settings: Awaited<ReturnType<typeof connection>>["settings"];
  try {
    ({ conn, settings } = await connection(ctx));
    payload = buildSalePayload({
      template, paymentMethod, exemptCode: settings.exemptTaxCode === "TVAC" ? "TVAC" : "TVAD",
      pointOfSale: settings.pointOfSale ?? "", establishment: settings.establishment ?? "", commercialMessage: settings.commercialMessage, footer: settings.footer, sellerName: ctx.user.name,
      customer: { name: inv.customer.name, taxId: inv.customer.taxId, phone: inv.customer.phone, email: inv.customer.email },
      lines: inv.lines.map((l) => ({ description: l.description, quantity: num(l.quantity), unitPrice: num(l.unitPrice), discountPct: num(l.discountPct), taxRate: num(l.taxRate), unit: l.unit })),
    });
  } catch (e) {
    if (e instanceof AppError || e instanceof FneInputError) return saveFailure(failure(e));
    throw e;
  }

  // réservation atomique : deux clics simultanés ne peuvent pas certifier deux fois la même facture
  const claimed = await ctx.db.invoice.updateMany({ where: { id, ...claimable() }, data: { fneStatus: "PENDING", fneAttemptAt: new Date(), fneError: null, fneTemplate: template, fnePaymentMethod: paymentMethod } });
  if (claimed.count === 0) throw businessRule("Une certification FNE est déjà en cours (ou terminée) pour cette facture : actualisez la page.");

  try {
    const cert = await signSaleInvoice(conn, payload);
    const items = matchFneItems(inv.lines.map((l) => ({ id: l.id, description: l.description, quantity: num(l.quantity) })), cert.items);
    await ctx.db.invoice.update({
      where: { id },
      data: { fneStatus: "CERTIFIED", fneReference: cert.reference, fneVerifyUrl: cert.verifyUrl, fneId: cert.fneId, fneItems: items, fneCertifiedAt: new Date(), fneError: null },
    });
    await recordSticker(ctx, cert);
    await audit(ctx, { action: "invoice.fne_certify", resource: "Invoice", resourceId: id, summary: `${ctx.user.name} a certifié la facture ${inv.number} auprès de la FNE (n° ${cert.reference}, ${settings.environment === "production" ? "production" : "environnement de test"}).`, after: { fneReference: cert.reference } });
    return { status: "CERTIFIED", reference: cert.reference, stickerWarning: cert.stickerWarning };
  } catch (e) {
    return saveFailure(failure(e));
  }
}

// ── Avoirs ────────────────────────────────────────────────────

/** Certifie un avoir émis : il s'appuie sur la facture d'origine certifiée (articles FNE et quantités retournées). */
export async function certifyCreditNote(ctx: Ctx, id: string): Promise<FneOutcome> {
  const cn = await ctx.db.creditNote.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, invoice: true } });
  if (!cn) throw notFound("Avoir");
  if (cn.status !== "ISSUED") throw businessRule("Seul un avoir émis peut être certifié FNE.");
  if (cn.fneStatus === "CERTIFIED") throw businessRule(`Cet avoir est déjà certifié FNE (${cn.fneReference}).`);

  const saveFailure = async (f: { status: "FAILED" | "UNKNOWN"; message: string }) => {
    await ctx.db.creditNote.update({ where: { id }, data: { fneStatus: f.status, fneError: f.message.slice(0, 1000) } });
    await audit(ctx, { action: "credit_note.fne_failed", resource: "CreditNote", resourceId: id, summary: `Certification FNE de l'avoir ${cn.number} non aboutie : ${f.message}` });
    return f;
  };

  let conn: FneConnection;
  let items: { id: string; quantity: number }[];
  try {
    ({ conn } = await connection(ctx));
    if (cn.invoice.fneStatus !== "CERTIFIED" || !cn.invoice.fneId) {
      throw businessRule(`La facture d'origine ${cn.invoice.number} n'est pas certifiée FNE : certifiez-la d'abord (un avoir FNE s'appuie sur la facture certifiée).`);
    }
    const map = new Map(((cn.invoice.fneItems ?? []) as { lineId: string; fneItemId: string }[]).map((m) => [m.lineId, m.fneItemId]));
    items = cn.lines.map((l) => {
      const fneItemId = l.invoiceLineId ? map.get(l.invoiceLineId) : undefined;
      if (!fneItemId) throw businessRule(`« ${l.description} » : article introuvable dans la facture certifiée ; certifiez cet avoir depuis votre espace FNE.`);
      return { id: fneItemId, quantity: num(l.quantity) };
    });
  } catch (e) {
    if (e instanceof AppError || e instanceof FneInputError) return saveFailure(failure(e));
    throw e;
  }

  const claimed = await ctx.db.creditNote.updateMany({ where: { id, ...claimable() }, data: { fneStatus: "PENDING", fneAttemptAt: new Date(), fneError: null } });
  if (claimed.count === 0) throw businessRule("Une certification FNE est déjà en cours (ou terminée) pour cet avoir : actualisez la page.");

  try {
    const cert = await signRefund(conn, cn.invoice.fneId, items);
    await ctx.db.creditNote.update({ where: { id }, data: { fneStatus: "CERTIFIED", fneReference: cert.reference, fneVerifyUrl: cert.verifyUrl, fneCertifiedAt: new Date(), fneError: null } });
    await recordSticker(ctx, cert);
    await audit(ctx, { action: "credit_note.fne_certify", resource: "CreditNote", resourceId: id, summary: `${ctx.user.name} a certifié l'avoir ${cn.number} auprès de la FNE (n° ${cert.reference}).`, after: { fneReference: cert.reference } });
    return { status: "CERTIFIED", reference: cert.reference, stickerWarning: cert.stickerWarning };
  } catch (e) {
    return saveFailure(failure(e));
  }
}

/** Certification automatique à l'émission : sans effet si la FNE est inactive ; une erreur n'annule jamais l'émission. */
export async function autoCertify(ctx: Ctx, kind: "invoice" | "credit-note", id: string, opts: { template?: FneTemplate; paymentMethod?: FnePaymentMethod } = {}): Promise<FneOutcome | null> {
  if (!(await fneAutoCertify(ctx))) return null;
  try {
    return kind === "invoice" ? await certifyInvoice(ctx, id, opts) : await certifyCreditNote(ctx, id);
  } catch (e) {
    return failure(e);
  }
}

/** Phrase de compte rendu d'une certification, pour les messages à l'utilisateur. */
export function fneOutcomeText(o: FneOutcome): string {
  if (o.status === "CERTIFIED") return `Certifiée FNE (n° ${o.reference})${o.stickerWarning ? " — attention : stock de stickers FNE bientôt épuisé" : ""}.`;
  return `Certification FNE non aboutie : ${o.message}`;
}
