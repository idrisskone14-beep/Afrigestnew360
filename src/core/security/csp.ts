/**
 * Politique de sécurité du contenu (CSP) — fonction pure, testée.
 *
 * Production : scripts autorisés UNIQUEMENT s'ils portent le nonce de la requête (`'strict-dynamic'` propage la confiance
 * aux scripts chargés par ceux-là) ; aucun `unsafe-inline` ni `unsafe-eval` côté scripts. Les styles gardent
 * `'unsafe-inline'` (attributs `style` de Tailwind, de Recharts et de framer-motion).
 * Développement : `unsafe-eval` en plus (rechargement à chaud de React) ; pas d'`upgrade-insecure-requests` (http local).
 */
export function buildCsp(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "frame-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

/** Nonce aléatoire (128 bits) encodé en base64 : un par requête, imprévisible. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
