import { NextResponse } from "next/server";
import { getPublicPlans } from "@/modules/platform/demo";

/**
 * Point de contrôle de déploiement : indique si la configuration est complète et si la base répond.
 * Ne révèle AUCUNE valeur : seulement les NOMS des variables manquantes ou invalides et un booléen pour la base.
 */
const REQUIRED = ["DATABASE_URL", "AUTH_SECRET", "ENCRYPTION_KEY", "APP_URL"] as const;

export async function GET() {
  const problems: string[] = [];
  for (const name of REQUIRED) if (!process.env[name]) problems.push(`${name} manquante`);
  if (process.env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) problems.push("ENCRYPTION_KEY invalide (64 caractères hexadécimaux attendus)");
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 16) problems.push("AUTH_SECRET trop courte");
  if (process.env.REQUIRE_EMAIL_VERIFICATION === "true" && !process.env.RESEND_API_KEY) problems.push("RESEND_API_KEY absente : les e-mails de vérification ne partiront pas");
  if (!process.env.CRON_SECRET) problems.push("CRON_SECRET manquante : tâche planifiée désactivée");

  let database: "ok" | "indisponible" = "indisponible";
  try {
    await getPublicPlans();
    database = "ok";
  } catch (e) {
    console.error("[health] base de données", e);
  }

  const ok = problems.filter((p) => !p.startsWith("RESEND") && !p.startsWith("CRON")).length === 0 && database === "ok";
  return NextResponse.json({ ok, database, problems }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
