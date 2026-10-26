import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Règles de confidentialité et de bruit du suivi d'erreurs — fonctions pures, testées.
 *
 * Principe : on envoie ce qu'il faut pour CORRIGER un bug (type d'erreur, pile, page, version) et rien de personnel :
 * ni cookies, ni en-têtes, ni corps de requête, ni adresse e-mail ou IP, ni jeton dans une adresse. Les erreurs attendues
 * (`AppError` : validation, droits, règle métier…) sont des réponses normales à l'utilisateur, pas des bugs : jamais envoyées.
 */

/** Routes dont un segment est un jeton secret (lien de partage, invitation, réinitialisation…). */
const TOKEN_ROUTES: [RegExp, string][] = [
  [/\/p\/[^/?#]+/g, "/p/[token]"],
  [/\/invitation\/[^/?#]+/g, "/invitation/[token]"],
  [/\/verifier-email\/[^/?#]+/g, "/verifier-email/[token]"],
  [/\/reinitialiser-mot-de-passe\/[^/?#]+/g, "/reinitialiser-mot-de-passe/[token]"],
  [/\/api\/p\/[^/?#]+/g, "/api/p/[token]"],
];

/** Retire la requête (?…) et le fragment, et masque les jetons des chemins : seule la « forme » de l'adresse est conservée. */
export function scrubUrl(url: string): string {
  let out = url.replace(/[?#].*$/, "");
  for (const [re, to] of TOKEN_ROUTES) out = out.replace(re, to);
  return out;
}

/** Origine (https://hôte) du point de réception d'un DSN Sentry, pour l'autoriser dans la CSP ; null si le DSN est absent ou invalide. */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

const isExpected = (hint?: EventHint, event?: ErrorEvent) => {
  const original = hint?.originalException as { name?: string } | undefined;
  return original?.name === "AppError" || event?.exception?.values?.some((v) => v.type === "AppError") === true;
};

/** Bruit sans intérêt pour un développeur (navigateurs, extensions, réseau coupé). */
export const IGNORED_ERRORS = [
  "ResizeObserver loop",
  "Non-Error promise rejection captured",
  /^(Failed to fetch|Load failed|NetworkError)/,
  /Loading chunk \d+ failed/,
  /extension:\/\//,
];

/** À brancher sur `beforeSend` : écarte les erreurs attendues, supprime les données personnelles, ajoute la « référence » affichée à l'utilisateur. */
export function scrubEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  if (isExpected(hint, event)) return null;

  const original = hint?.originalException as { digest?: unknown } | undefined;
  // « Référence : 1234567890 » (affichée sur la page d'erreur) : permet de retrouver l'incident à partir du message d'un client
  if (typeof original?.digest === "string") event.tags = { ...event.tags, digest: original.digest };

  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
  }
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  delete event.server_name;
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  event.breadcrumbs = event.breadcrumbs?.map((b) => {
    const data = b.data && typeof b.data === "object" ? { ...b.data } : undefined;
    if (data) for (const k of ["url", "from", "to"]) if (typeof data[k] === "string") data[k] = scrubUrl(data[k] as string);
    return { ...b, ...(data ? { data } : {}), message: b.message && /@|token/i.test(b.message) ? "[masqué]" : b.message };
  });
  return event;
}
