import { IGNORED_ERRORS, scrubEvent } from "./sentry-filter";

/**
 * Réglages communs (serveur et navigateur) du suivi d'erreurs. Sans DSN, `enabled` est faux : le SDK ne fait rien et
 * n'envoie rien (développement, tests, préproduction sans compte). Aucune trace de performance, aucun enregistrement de session.
 */
export function sentryOptions(dsn: string | undefined, meta: { environment?: string; release?: string } = {}) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: meta.environment || process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
    release: meta.release || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    ignoreErrors: IGNORED_ERRORS,
    beforeSend: scrubEvent,
  };
}
