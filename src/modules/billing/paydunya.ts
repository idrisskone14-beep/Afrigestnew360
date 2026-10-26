import "server-only";

/**
 * Client PayDunya (API « checkout-invoice » : paiement par redirection vers la page PayDunya — Mobile Money, cartes).
 * Documentation : https://developers.paydunya.com/doc/FR/http_json
 *
 * Les clés (PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN) restent côté serveur ; elles ne sont jamais renvoyées
 * au navigateur. PAYDUNYA_MODE=live active les clés de production (« test » par défaut : bac à sable).
 */
export interface PaydunyaConfig {
  masterKey: string;
  privateKey: string;
  token: string;
  mode: "test" | "live";
}

const BASE = { test: "https://app.paydunya.com/sandbox-api/v1", live: "https://app.paydunya.com/api/v1" } as const;
const TIMEOUT_MS = 15_000;

export function paydunyaConfig(env: Record<string, string | undefined> = process.env): PaydunyaConfig | null {
  const { PAYDUNYA_MASTER_KEY: masterKey, PAYDUNYA_PRIVATE_KEY: privateKey, PAYDUNYA_TOKEN: token } = env;
  if (!masterKey || !privateKey || !token) return null;
  return { masterKey, privateKey, token, mode: env.PAYDUNYA_MODE === "live" ? "live" : "test" };
}

export class PaydunyaError extends Error {}

export interface CreateInvoiceInput {
  amount: number;
  description: string;
  storeName: string;
  websiteUrl: string;
  returnUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  customData: Record<string, string>;
}

async function call(cfg: PaydunyaConfig, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${BASE[cfg.mode]}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        "PAYDUNYA-MASTER-KEY": cfg.masterKey,
        "PAYDUNYA-PRIVATE-KEY": cfg.privateKey,
        "PAYDUNYA-TOKEN": cfg.token,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new PaydunyaError(`PayDunya injoignable (${e instanceof Error ? e.name : "erreur réseau"}).`);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!json || typeof json !== "object") throw new PaydunyaError(`Réponse PayDunya illisible (HTTP ${res.status}).`);
  return json as Record<string, unknown>;
}

/** Crée une facture PayDunya et renvoie son jeton et l'adresse de la page de paiement. */
export async function createInvoice(cfg: PaydunyaConfig, input: CreateInvoiceInput): Promise<{ token: string; url: string }> {
  const json = await call(cfg, "/checkout-invoice/create", {
    method: "POST",
    body: {
      invoice: {
        total_amount: input.amount,
        description: input.description,
        items: { item_0: { name: input.description, quantity: 1, unit_price: input.amount, total_price: input.amount, description: input.description } },
      },
      store: { name: input.storeName, website_url: input.websiteUrl },
      custom_data: input.customData,
      actions: { return_url: input.returnUrl, cancel_url: input.cancelUrl, callback_url: input.callbackUrl },
    },
  });
  const url = json.response_text;
  const token = json.token;
  if (json.response_code !== "00" || typeof url !== "string" || typeof token !== "string") {
    throw new PaydunyaError(`PayDunya a refusé la facture (${typeof json.response_text === "string" ? json.response_text : "motif inconnu"}).`);
  }
  return { token, url };
}

export type InvoiceStatus = "pending" | "completed" | "cancelled" | "failed";

export interface InvoiceState {
  status: InvoiceStatus;
  totalAmount: number | null;
  customData: Record<string, unknown>;
  receiptUrl: string | null;
  failReason: string | null;
}

/** Interroge PayDunya sur l'état réel d'une facture : source de vérité, indépendante de ce qu'envoie le navigateur. */
export async function confirmInvoice(cfg: PaydunyaConfig, token: string): Promise<InvoiceState> {
  const json = await call(cfg, `/checkout-invoice/confirm/${encodeURIComponent(token)}`, { method: "GET" });
  return parseInvoiceState(json);
}

export function parseInvoiceState(json: Record<string, unknown>): InvoiceState {
  const raw = typeof json.status === "string" ? json.status.toLowerCase() : "";
  // la documentation écrit « cancelled » ; certains exemples « canceled » ; tout statut inconnu reste « pending » (jamais « completed »)
  const status: InvoiceStatus = raw === "completed" ? "completed" : raw === "failed" ? "failed" : raw === "cancelled" || raw === "canceled" ? "cancelled" : "pending";
  const invoice = (json.invoice ?? {}) as Record<string, unknown>;
  const total = Number(invoice.total_amount);
  return {
    status,
    totalAmount: Number.isFinite(total) ? total : null,
    customData: json.custom_data && typeof json.custom_data === "object" ? (json.custom_data as Record<string, unknown>) : {},
    receiptUrl: typeof json.receipt_url === "string" ? json.receipt_url : null,
    failReason: typeof json.fail_reason === "string" ? json.fail_reason : null,
  };
}

/**
 * Extrait le jeton de facture d'une notification (IPN). PayDunya poste en `application/x-www-form-urlencoded` avec des clés
 * imbriquées (`data[invoice][token]`) ; le JSON `{ data: { invoice: { token } } }` est aussi accepté.
 * Le jeton extrait N'EST PAS digne de confiance : il sert uniquement à retrouver un paiement en attente, dont l'état est
 * ensuite relu auprès de PayDunya (`confirmInvoice`).
 */
export function parseIpnToken(body: string, contentType: string | null): string | null {
  const valid = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(v) ? v : null);
  if (contentType?.includes("json")) {
    try {
      const j = JSON.parse(body) as { data?: { invoice?: { token?: unknown } } };
      return valid(j?.data?.invoice?.token);
    } catch {
      return null;
    }
  }
  const params = new URLSearchParams(body);
  return valid(params.get("data[invoice][token]"));
}
