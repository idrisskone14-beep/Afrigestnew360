import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/core/errors";
import { enforceRateLimit } from "@/core/security/rate-limit";
import { sharedDocumentPdf } from "@/modules/sales/public-share";

/** PDF du document partagé (lien public). Limité en fréquence : la génération d'un PDF coûte. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    await enforceRateLimit("share-pdf", { limit: 30, windowMs: 10 * 60_000 });
    const { data, filename } = await sharedDocumentPdf(token);
    const download = req.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(null, { status: e.code === "RATE_LIMITED" ? 429 : 404 });
    console.error("[share:pdf]", e);
    return new NextResponse(null, { status: 500 });
  }
}
