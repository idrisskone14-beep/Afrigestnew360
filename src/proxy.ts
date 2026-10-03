import { NextResponse, type NextRequest } from "next/server";

/**
 * Filtre de première ligne : redirige vers /connexion si AUCUN cookie de session n'est présent.
 * La validité réelle de la session (révocation, expiration) et les autorisations sont revérifiées
 * côté serveur dans chaque page / action (`requireTenantContext`, `defineTenantAction`…).
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    const next = req.nextUrl.pathname + req.nextUrl.search;
    url.pathname = "/connexion";
    url.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/super-admin/:path*"] };
