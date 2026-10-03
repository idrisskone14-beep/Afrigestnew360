import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { loadContextState } from "@/core/tenant/context";
import { detectDocument } from "@/modules/documents/files";
import { readVersion } from "@/modules/documents/service";

/**
 * Télécharge un document de l'entreprise active. Authentification + module + droit « documents » + accès au document
 * (propriétaire, partage, visibilité, droits sur les entités liées) revérifiés à chaque appel. Le type servi est RE-DÉTECTÉ
 * sur les octets ; seuls PDF et images peuvent être affichés dans le navigateur (`?inline=1`), le reste est toujours téléchargé.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const v = sp.get("v");
  if (!z.string().uuid().safeParse(id).success || (v !== null && !/^\d{1,6}$/.test(v))) return new NextResponse(null, { status: 404 });

  const state = await loadContextState();
  if (state.status === "unauthenticated") return new NextResponse(null, { status: 401 });
  if (state.status !== "ok") return new NextResponse(null, { status: 403 });
  const { ctx } = state;
  if (!ctx.hasModule("documents") || !ctx.can("documents.document.read")) return new NextResponse(null, { status: 403 });

  try {
    const { data, version } = await readVersion(ctx, id, v === null ? undefined : Number(v));
    const real = detectDocument(data, version.fileName);
    const inline = sp.get("inline") === "1" && real?.inline === true;
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": real?.mime ?? "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${version.fileName.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(version.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Les visionneuses PDF des navigateurs refusent une réponse « sandbox » ; le type étant re-détecté sur les octets, un PDF inline ne porte que l'interdiction d'être encadré.
        "Content-Security-Policy": inline && real?.mime === "application/pdf" ? "frame-ancestors 'none'" : "default-src 'none'; img-src 'self' data:; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") return new NextResponse(null, { status: 404 });
    console.error("[documents:download]", e);
    return new NextResponse("Erreur de lecture du document.", { status: 500 });
  }
}
