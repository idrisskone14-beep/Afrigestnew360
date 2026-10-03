import { NextResponse, type NextRequest } from "next/server";
import { exportResponse, parseFormat } from "@/core/export/serve";
import { AppError } from "@/core/errors";
import { loadContextState } from "@/core/tenant/context";
import { REPORT_BY_KEY } from "@/modules/reports/catalog";
import { buildReport, canRunReport } from "@/modules/reports/service";

/**
 * Export d'un rapport (Excel, CSV, PDF). Authentification, module « Rapports », droit de lecture du rapport ET droit d'export
 * sont revérifiés à chaque appel ; les données sont celles du service de rapport (isolées par entreprise, filtrées par droits).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const def = Object.hasOwn(Object.fromEntries(REPORT_BY_KEY), key) ? REPORT_BY_KEY.get(key) : undefined;
  const format = parseFormat(req.nextUrl.searchParams.get("format"));
  if (!def || !format) return new NextResponse(null, { status: 404 });

  const state = await loadContextState();
  if (state.status === "unauthenticated") return new NextResponse(null, { status: 401 });
  if (state.status !== "ok") return new NextResponse(null, { status: 403 });
  const { ctx } = state;
  if (!canRunReport(ctx, def) || !ctx.can("reports.export.run")) return new NextResponse(null, { status: 403 });

  try {
    const { result } = await buildReport(ctx, key, (k) => req.nextUrl.searchParams.get(k) ?? undefined);
    return await exportResponse(result.table, format);
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(null, { status: e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400 });
    console.error("[reports:export]", e);
    return new NextResponse("Erreur de génération du rapport.", { status: 500 });
  }
}
