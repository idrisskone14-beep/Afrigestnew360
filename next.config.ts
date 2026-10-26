import type { NextConfig } from "next";

// La CSP (à nonce par requête) est posée par src/proxy.ts ; ici les en-têtes statiques.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  // suivi d'erreurs dans le navigateur : le DSN (public par conception) et la version sont figés à la construction
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "",
    NEXT_PUBLIC_SENTRY_ENV: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || "",
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
  serverExternalPackages: ["@prisma/client", "pg", "bcryptjs", "pdfkit", "exceljs", "web-push", "@aws-sdk/client-s3"],
  experimental: {
    authInterrupts: true, // forbidden() / unauthorized()
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // le service worker doit être revalidé à chaque démarrage : une mise à jour ne doit jamais rester bloquée en cache
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
