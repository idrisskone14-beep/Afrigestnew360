import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/core/monitoring/sentry-options";

/**
 * Au démarrage du serveur : active le suivi d'erreurs (si SENTRY_DSN est défini) et signale clairement dans les journaux
 * une configuration incomplète (aucune valeur n'est affichée).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(sentryOptions(process.env.SENTRY_DSN));
    return;
  }
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  Sentry.init(sentryOptions(process.env.SENTRY_DSN));
  const { checkEnv } = await import("@/core/env");
  for (const p of checkEnv()) console[p.level === "blocking" ? "error" : "warn"](`[config] ${p.message}`);
}

/** Erreurs de rendu, de routes et d'actions serveur non interceptées : remontées au suivi d'erreurs (filtrées par scrubEvent). */
export const onRequestError = Sentry.captureRequestError;
