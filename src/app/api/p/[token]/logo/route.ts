import { NextResponse, type NextRequest } from "next/server";
import { readCompanyLogo } from "@/core/storage";
import { resolveShare } from "@/core/share/service";

/** Logo de l'entreprise émettrice d'un document partagé : accessible avec le lien du document, pas plus. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share) return new NextResponse(null, { status: 404 });
  const logo = await readCompanyLogo(share.companyId);
  if (!logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(logo.data), {
    headers: { "Content-Type": logo.mime, "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
