import "server-only";

/**
 * Client de la plateforme FNE (facture normalisée électronique) de la DGI de Côte d'Ivoire.
 * Référence : « Procédure d'interfaçage des entreprises par API » (DGI, mai 2025).
 *
 *   POST {base}/external/invoices/sign            certification d'une facture de vente
 *   POST {base}/external/invoices/{id}/refund     certification d'un avoir sur une facture certifiée
 *
 * Authentification : `Authorization: Bearer <clé API>` (clé propre à chaque entreprise, visible dans son espace FNE,
 * onglet « Paramétrage », après validation par la DGI). Ce fichier ne lit aucune base : il construit les requêtes,
 * appelle la plateforme et normalise ses réponses (testable sans réseau).
 */

export const FNE_TEST_URL = "http://54.247.95.108/ws";

export type { FnePaymentMethod, FneTemplate } from "./schemas";
import type { FnePaymentMethod, FneTemplate } from "./schemas";

/** Codes de TVA de la FNE (annexe 1). */
export const FNE_TAX_CODES = { normal: "TVA", reduced: "TVAB", exemptConventional: "TVAC", exemptLegal: "TVAD" } as const;
export type FneExemptCode = "TVAC" | "TVAD";
export type FneTaxCode = "TVA" | "TVAB" | FneExemptCode;

export type FneEnvironment = "test" | "production";

/**
 * Interrupteur de la plateforme : tant que la DGI n'a pas autorisé le raccordement, la FNE reste invisible et inactive
 * (aucun onglet, aucune certification, aucun appel). Pour l'ouvrir : FNE_ENABLED=true.
 */
export const fneFeatureEnabled = (env: Record<string, string | undefined> = process.env) => env.FNE_ENABLED === "true";

/** URL de base de l'API : environnement de test public de la DGI, ou URL de production transmise par la DGI (FNE_PROD_URL). */
export function fneBaseUrl(environment: FneEnvironment, env: Record<string, string | undefined> = process.env): string | null {
  const raw = environment === "production" ? env.FNE_PROD_URL : env.FNE_TEST_URL || FNE_TEST_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Code FNE d'une ligne d'après son taux de TVA : 18 % → TVA, 9 % → TVAB, 0 % → code d'exonération choisi par l'entreprise. */
export function fneTaxCode(rate: number, exemptCode: FneExemptCode): FneTaxCode | null {
  if (Math.abs(rate - 18) < 1e-6) return "TVA";
  if (Math.abs(rate - 9) < 1e-6) return "TVAB";
  if (Math.abs(rate) < 1e-6) return exemptCode;
  return null;
}

/** Type de facturation déduit du client : étranger → B2F ; entreprise avec NCC → B2B ; sinon particulier (B2C). B2G se choisit à la main. */
export function defaultFneTemplate(customer: { type: string; taxId: string | null; country: string | null }, companyCountry = "CI"): FneTemplate {
  if (customer.country && customer.country !== companyCountry) return "B2F";
  if (customer.type === "COMPANY" && customer.taxId?.trim()) return "B2B";
  return "B2C";
}

export interface FneSaleInput {
  template: FneTemplate;
  paymentMethod: FnePaymentMethod;
  exemptCode: FneExemptCode;
  pointOfSale: string;
  establishment: string;
  commercialMessage?: string | null;
  footer?: string | null;
  sellerName?: string | null;
  customer: { name: string; taxId: string | null; phone: string | null; email: string | null };
  lines: { description: string; quantity: number; unitPrice: number; discountPct: number; taxRate: number; unit: string }[];
}

/** Une erreur de préparation : rien n'a été envoyé à la FNE. */
export class FneInputError extends Error {}

/**
 * Erreur d'appel à la FNE.
 *  - `rejected` : la FNE a répondu par un refus (400, 401…) : la facture n'est PAS certifiée, on peut corriger et réessayer.
 *  - `unknown`  : pas de réponse exploitable (réseau, délai, 5xx, réponse illisible) : la facture a PU être certifiée.
 */
export class FneCallError extends Error {
  constructor(message: string, readonly outcome: "rejected" | "unknown", readonly status?: number) {
    super(message);
  }
}

const clean = (s: string | null | undefined) => (s ?? "").trim();
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Corps de la requête de certification d'une facture de vente (API #1). Lève FneInputError si une donnée exigée manque. */
export function buildSalePayload(input: FneSaleInput): Record<string, unknown> {
  const missing: string[] = [];
  if (!clean(input.pointOfSale)) missing.push("point de vente (Paramètres → FNE)");
  if (!clean(input.establishment)) missing.push("établissement (Paramètres → FNE)");
  if (!clean(input.customer.phone)) missing.push("téléphone du client");
  if (!clean(input.customer.email)) missing.push("e-mail du client");
  if (input.template === "B2B" && !clean(input.customer.taxId)) missing.push("NCC du client (obligatoire en B2B)");
  if (missing.length) throw new FneInputError(`Données exigées par la FNE manquantes : ${missing.join(", ")}.`);
  if (input.lines.length === 0) throw new FneInputError("La facture n'a aucune ligne.");

  const items = input.lines.map((l) => {
    if (l.quantity <= 0 || l.unitPrice < 0) {
      throw new FneInputError(`« ${l.description} » : la FNE n'accepte que des quantités et des prix positifs (une déduction d'acompte ou une ligne négative se certifie depuis l'espace FNE).`);
    }
    const code = fneTaxCode(l.taxRate, input.exemptCode);
    if (!code) throw new FneInputError(`« ${l.description} » : taux de TVA de ${l.taxRate} % non reconnu par la FNE (18 %, 9 % ou 0 % uniquement).`);
    return {
      taxes: [code],
      description: l.description.slice(0, 250),
      quantity: round(l.quantity, 3),
      amount: round(l.unitPrice, 2),
      discount: round(l.discountPct, 2),
      measurementUnit: l.unit,
    };
  });

  return {
    invoiceType: "sale",
    paymentMethod: input.paymentMethod,
    template: input.template,
    isRne: false,
    ...(input.template === "B2B" ? { clientNcc: clean(input.customer.taxId) } : {}),
    clientCompanyName: input.customer.name,
    clientPhone: clean(input.customer.phone).replace(/[\s.-]/g, ""),
    clientEmail: clean(input.customer.email),
    ...(clean(input.sellerName) ? { clientSellerName: clean(input.sellerName) } : {}),
    pointOfSale: clean(input.pointOfSale),
    establishment: clean(input.establishment),
    ...(clean(input.commercialMessage) ? { commercialMessage: clean(input.commercialMessage) } : {}),
    ...(clean(input.footer) ? { footer: clean(input.footer) } : {}),
    foreignCurrency: "",
    foreignCurrencyRate: 0,
    items,
  };
}

export interface FneCertification {
  reference: string;
  verifyUrl: string;
  stickerBalance: number | null;
  stickerWarning: boolean;
}

export interface FneSaleCertification extends FneCertification {
  fneId: string;
  /** Identifiants FNE des articles, dans l'ordre renvoyé par la plateforme. */
  items: { id: string; description: string; quantity: number }[];
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

function parseCertification(json: Record<string, unknown>): FneCertification {
  const reference = str(json.reference);
  const verifyUrl = str(json.token);
  if (!reference || !verifyUrl) throw new FneCallError("Réponse de la FNE incomplète (numéro ou code de vérification absent).", "unknown");
  return { reference, verifyUrl, stickerBalance: numOrNull(json.balance_sticker), stickerWarning: json.warning === true || json.warning === "true" };
}

/** Normalise la réponse de certification d'une facture de vente. */
export function parseSaleResponse(json: Record<string, unknown>): FneSaleCertification {
  const base = parseCertification(json);
  const invoice = (json.invoice ?? {}) as Record<string, unknown>;
  const fneId = str(invoice.id);
  if (!fneId) throw new FneCallError("Réponse de la FNE incomplète (identifiant de facture absent).", "unknown");
  const items = Array.isArray(invoice.items)
    ? invoice.items.flatMap((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        const id = str(o.id);
        return id ? [{ id, description: str(o.description) ?? "", quantity: numOrNull(o.quantity) ?? 0 }] : [];
      })
    : [];
  return { ...base, fneId, items };
}

/** Message lisible à partir d'une réponse d'erreur FNE ({ message, error, statusCode, errors }). */
export function fneErrorMessage(status: number, json: Record<string, unknown> | null): string {
  const msg = json ? str(json.message) : null;
  const details = json?.errors && typeof json.errors === "object" && Object.keys(json.errors).length ? ` (${JSON.stringify(json.errors).slice(0, 300)})` : "";
  if (status === 401) return `Clé API FNE refusée${msg ? ` : ${msg}` : ""}. Vérifiez la clé dans Paramètres → FNE.`;
  return `La FNE a refusé la demande (HTTP ${status}${msg ? ` : ${msg}` : ""})${details}.`;
}

const TIMEOUT_MS = 25_000;

async function post(baseUrl: string, apiKey: string, path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new FneCallError(`Plateforme FNE injoignable (${e instanceof Error ? e.name : "erreur réseau"}).`, "unknown");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status >= 500) throw new FneCallError(`La plateforme FNE ne répond pas correctement (HTTP ${res.status}).`, "unknown", res.status);
  if (!res.ok) throw new FneCallError(fneErrorMessage(res.status, json), "rejected", res.status);
  if (!json || typeof json !== "object") throw new FneCallError(`Réponse de la FNE illisible (HTTP ${res.status}).`, "unknown", res.status);
  return json;
}

export interface FneConnection { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }

/** Certifie une facture de vente (API #1). */
export async function signSaleInvoice(conn: FneConnection, payload: Record<string, unknown>): Promise<FneSaleCertification> {
  return parseSaleResponse(await post(conn.baseUrl, conn.apiKey, "/external/invoices/sign", payload, conn.fetchImpl));
}

/** Certifie un avoir (API #2) : articles de la facture d'origine (identifiants FNE) et quantités retournées. */
export async function signRefund(conn: FneConnection, fneInvoiceId: string, items: { id: string; quantity: number }[]): Promise<FneCertification> {
  if (!/^[\w-]{1,64}$/.test(fneInvoiceId)) throw new FneInputError("Identifiant FNE de la facture d'origine invalide.");
  if (items.length === 0) throw new FneInputError("L'avoir n'a aucune ligne rattachée à la facture certifiée.");
  const body = { items: items.map((i) => ({ id: i.id, quantity: round(i.quantity, 3) })) };
  return parseCertification(await post(conn.baseUrl, conn.apiKey, `/external/invoices/${encodeURIComponent(fneInvoiceId)}/refund`, body, conn.fetchImpl));
}

/**
 * Associe chaque ligne de la facture à l'article FNE renvoyé. La FNE renvoie les articles dans l'ordre de la requête :
 * on les apparie par position quand les nombres concordent, sinon par désignation et quantité.
 */
export function matchFneItems(lines: { id: string; description: string; quantity: number }[], items: FneSaleCertification["items"]): { lineId: string; fneItemId: string }[] {
  if (items.length === lines.length) return lines.map((l, i) => ({ lineId: l.id, fneItemId: items[i]!.id }));
  const pool = [...items];
  return lines.flatMap((l) => {
    const k = pool.findIndex((it) => it.description.trim() === l.description.slice(0, 250).trim() && Math.abs(it.quantity - l.quantity) < 1e-6);
    if (k < 0) return [];
    const [it] = pool.splice(k, 1);
    return [{ lineId: l.id, fneItemId: it!.id }];
  });
}
