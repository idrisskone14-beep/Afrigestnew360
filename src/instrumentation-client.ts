import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/core/monitoring/sentry-options";

/** Suivi d'erreurs dans le navigateur (si SENTRY_DSN est défini à la construction) : erreurs JavaScript non interceptées, sans données personnelles. */
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, { environment: process.env.NEXT_PUBLIC_SENTRY_ENV, release: process.env.NEXT_PUBLIC_SENTRY_RELEASE }));
