import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { purgeRateLimits } from "@/core/security/rate-limit";
import { generateAllAlerts } from "@/modules/platform/alerts";

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Tâche planifiée (cron) : génère les alertes d'échéances et de stock de toutes les entreprises.
 * Protégée par le secret `CRON_SECRET` (en-tête `Authorization: Bearer …`) ; désactivée si le secret n'est pas configuré.
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "CRON_SECRET non configuré (16 caractères minimum)." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(token, secret)) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await generateAllAlerts();
    await purgeRateLimits().catch((e) => console.error("[cron:rate-limit]", e)); // ménage des compteurs périmés
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[cron:alerts]", e);
    return NextResponse.json({ error: "Échec de la génération des alertes." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
