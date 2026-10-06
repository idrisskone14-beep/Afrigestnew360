import { NextResponse } from "next/server";
import { checkEnv } from "@/core/env";
import { databaseLatency } from "@/modules/platform/demo";

/**
 * Point de contrôle de déploiement : indique si la configuration est complète et si la base répond.
 * Ne révèle AUCUNE valeur : seulement les NOMS des variables manquantes ou invalides, un booléen pour la base et sa latence
 * (utile pour juger si la base est « proche » de l'application : au-delà de ~10 ms par aller-retour, chaque page ralentit).
 */
export async function GET() {
  const issues = checkEnv();
  const latency = await databaseLatency();
  const database = latency ? "ok" : "indisponible";
  const ok = !issues.some((i) => i.level === "blocking") && latency !== null;
  return NextResponse.json(
    {
      ok,
      database,
      // 1 requête simple (≈ 1 aller-retour), puis 1 requête applicative complète (≈ 4 allers-retours) : l'écart donne la latence réseau
      ...(latency ? { latencyMs: { simpleQuery: latency.simpleMs, appQuery: latency.appQueryMs, region: process.env.VERCEL_REGION ?? null } } : {}),
      problems: issues.map((i) => (i.level === "warning" ? `(avertissement) ${i.message}` : i.message)),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
