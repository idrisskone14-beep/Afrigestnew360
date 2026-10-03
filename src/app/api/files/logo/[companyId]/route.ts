import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/core/auth/session";
import { readCompanyLogo } from "@/core/storage";
import { isActiveMember } from "@/core/tenant/access";

/** Sert le logo d'une entreprise, uniquement à ses membres actifs. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  if (!z.string().uuid().safeParse(companyId).success) return new NextResponse(null, { status: 404 });

  const session = await getCurrentSession();
  if (!session) return new NextResponse(null, { status: 401 });
  if (!(await isActiveMember(session.user.id, companyId))) return new NextResponse(null, { status: 404 });

  const logo = await readCompanyLogo(companyId);
  if (!logo) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
