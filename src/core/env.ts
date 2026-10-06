/**
 * Vérification de la configuration d'exécution. Ne lit ni n'expose AUCUNE valeur : seulement les NOMS des variables
 * manquantes ou invalides. Utilisée par `/api/health` et au démarrage du serveur (`instrumentation.ts`).
 */
export interface EnvProblem {
  /** `blocking` : l'application ne peut pas fonctionner correctement ; `warning` : fonction dégradée. */
  level: "blocking" | "warning";
  message: string;
}

export function checkEnv(env: Record<string, string | undefined> = process.env): EnvProblem[] {
  const out: EnvProblem[] = [];
  const blocking = (message: string) => out.push({ level: "blocking", message });
  const warning = (message: string) => out.push({ level: "warning", message });

  for (const name of ["DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY", "APP_URL"]) if (!env[name]) blocking(`${name} manquante`);
  if (env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY)) blocking("ENCRYPTION_KEY invalide (64 caractères hexadécimaux attendus)");
  if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32) blocking("AUTH_SECRET trop courte (32 caractères minimum)");
  if (env.APP_URL && !/^https?:\/\//.test(env.APP_URL)) blocking("APP_URL doit commencer par http:// ou https://");

  if (env.NODE_ENV === "production") {
    if (env.APP_URL?.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(env.APP_URL)) warning("APP_URL en http:// : utilisez https:// en production");
    if (env.DATABASE_URL && !/sslmode=|ssl=true/.test(env.DATABASE_URL) && !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) warning("DATABASE_URL sans sslmode : la connexion à la base n'est peut-être pas chiffrée");
  }
  if (env.REQUIRE_EMAIL_VERIFICATION === "true" && !env.RESEND_API_KEY) warning("RESEND_API_KEY absente : les e-mails de vérification ne partiront pas");
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) warning("CRON_SECRET absente ou trop courte : tâche planifiée désactivée");
  return out;
}
