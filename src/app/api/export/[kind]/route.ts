import { NextResponse, type NextRequest } from "next/server";
import { exportResponse, parseFormat } from "@/core/export/serve";
import { AppError } from "@/core/errors";
import { loadContextState } from "@/core/tenant/context";
import { EXPORTERS } from "@/modules/data/exports";

/**
 * Export de données de l'entreprise active (journal d'audit, listes…). Authentification, module et permissions sont
 * vérifiés ici à chaque appel ; le contenu est produit par les services (donc filtré par isolation et droits).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const exporter = Object.hasOwn(EXPORTERS, kind) ? EXPORTERS[kind] : undefined;
  const format = parseFormat(req.nextUrl.searchParams.get("format"));
  if (!exporter || !format) return new NextResponse(null, { status: 404 });

  const state = await loadContextState();
  if (state.status === "unauthenticated") return new NextResponse(null, { status: 401 });
  if (state.status !== "ok") return new NextResponse(null, { status: 403 });
  const { ctx } = state;
  if ((exporter.module && !ctx.hasModule(exporter.module)) || !exporter.permissions.every((p) => ctx.can(p))) return new NextResponse(null, { status: 403 });

  try {
    const table = await exporter.build(ctx, (k) => req.nextUrl.searchParams.get(k) ?? undefined);
    return await exportResponse(table, format);
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(null, { status: e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400 });
    console.error("[export]", e);
    return new NextResponse("Erreur de génération de l'export.", { status: 500 });
  }
}
