import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runAllDueRecurring } from "@/modules/platform/recurring-runner";

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Tâche planifiée : génère les factures récurrentes échues (toutes entreprises). Même protection que `/api/cron/alerts` :
 * secret `CRON_SECRET` en `Authorization: Bearer …`, désactivée sans secret.
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "CRON_SECRET non configuré (16 caractères minimum)." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(token, secret)) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    return NextResponse.json(await runAllDueRecurring(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[cron:recurring]", e);
    return NextResponse.json({ error: "Échec de la génération des factures récurrentes." }, { status: 500 });
  }
}

/** Durée maximale d'exécution (secondes) sur Vercel : imports, exports, PDF et envois de fichiers dépassent la durée par défaut. */
export const maxDuration = 60;

export const GET = run;
export const POST = run;
