import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, generateNonce } from "@/core/security/csp";

/**
 * Filtre de première ligne, appliqué à toutes les pages :
 *  1. pose une CSP à nonce par requête (voir `core/security/csp.ts`) ;
 *  2. redirige vers /connexion si AUCUN cookie de session n'est présent sur /app et /super-admin.
 * La validité réelle de la session (révocation, expiration) et les autorisations sont revérifiées
 * côté serveur dans chaque page / action (`requireTenantContext`, `defineTenantAction`…).
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
const PROTECTED = /^\/(app|super-admin)(\/|$)/;

export function proxy(req: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production" });

  if (PROTECTED.test(req.nextUrl.pathname) && !SESSION_COOKIES.some((name) => req.cookies.has(name))) {
    const url = req.nextUrl.clone();
    const next = req.nextUrl.pathname + req.nextUrl.search;
    url.pathname = "/connexion";
    url.search = `?next=${encodeURIComponent(next)}`;
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  // Next lit la CSP de la REQUÊTE pour poser le nonce sur ses propres scripts ; `x-nonce` sert aux nôtres.
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // pages uniquement : ni fichiers statiques de Next, ni routes d'API (réponses JSON/fichiers), ni icônes
  matcher: [{ source: "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
