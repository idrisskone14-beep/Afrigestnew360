/**
 * Vérification de la configuration d'exécution. Ne lit ni n'expose AUCUNE valeur : seulement les NOMS des variables
 * manquantes ou invalides. Utilisée par `/api/health` et au démarrage du serveur (`instrumentation.ts`).
 */
import { missingLegal } from "@/lib/legal";

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
  // fichiers (logos, documents) : S3-compatible, ou disque — éphémère sur Vercel, où tout fichier serait perdu
  if (env.S3_BUCKET) {
    for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!env[name]) blocking(`${name} manquante (stockage S3 : S3_BUCKET est défini)`);
    if (env.S3_ENDPOINT && !/^https?:\/\//.test(env.S3_ENDPOINT)) blocking("S3_ENDPOINT doit commencer par https://");
  } else if (env.VERCEL) {
    blocking("S3_BUCKET manquante : le disque de Vercel est éphémère, les logos et documents seraient perdus (voir docs/DEPLOIEMENT.md §8)");
  } else if (env.NODE_ENV === "production") {
    warning("Fichiers stockés sur le disque (UPLOAD_DIR) : prévoyez un volume durable et sauvegardé, ou renseignez S3_BUCKET");
  }
  // suivi d'erreurs : sans DSN, aucune erreur n'est remontée (seuls les journaux Vercel les gardent)
  if (env.SENTRY_DSN) {
    if (!/^https:\/\/[^@\s]+@[^/\s]+\/\d+$/.test(env.SENTRY_DSN)) warning("SENTRY_DSN invalide (format https://<clé>@<hôte>/<projet> attendu) : erreurs non remontées");
  } else if (env.NODE_ENV === "production") {
    warning("SENTRY_DSN absente : les erreurs des utilisateurs ne sont pas remontées (voir docs/EXPLOITATION.md)");
  }
  // pages légales (mentions légales, conditions, confidentialité) : informations de l'éditeur à renseigner
  const legal = missingLegal(env);
  if (legal.length > 0) warning(`Pages légales incomplètes : ${legal.join(", ")} absente(s) (affichées « [à compléter] » sur le site)`);
  if (env.REQUIRE_EMAIL_VERIFICATION === "true" && !env.RESEND_API_KEY) warning("RESEND_API_KEY absente : les e-mails de vérification ne partiront pas");
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) warning("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absentes : notifications push désactivées (npm run push:keys)");
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) warning("CRON_SECRET absente ou trop courte : tâche planifiée désactivée");
  return out;
}
