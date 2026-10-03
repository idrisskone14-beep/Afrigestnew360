import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/core/errors";
import { loadContextState } from "@/core/tenant/context";
import { PAYROLL_PDF_PERMISSION, buildPayrollPdf, type PayrollPdfKind } from "@/modules/payroll/pdf";
import { PURCHASE_PDF_PERMISSION, buildPurchasePdf, type PurchasePdfKind } from "@/modules/purchasing/pdf";
import { PDF_PERMISSION, buildPdf, type PdfKind } from "@/modules/sales/pdf";

const SALES_KINDS = Object.keys(PDF_PERMISSION) as PdfKind[];
const PURCHASE_KINDS = Object.keys(PURCHASE_PDF_PERMISSION) as PurchasePdfKind[];
const PAYROLL_KINDS = Object.keys(PAYROLL_PDF_PERMISSION) as PayrollPdfKind[];

/** Génère le PDF d'un document de l'entreprise active (authentification + module + permission ; accès au document revérifié par le service). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const sales = SALES_KINDS.find((k) => k === type);
  const purchase = PURCHASE_KINDS.find((k) => k === type);
  const payroll = PAYROLL_KINDS.find((k) => k === type);
  if ((!sales && !purchase && !payroll) || !z.string().uuid().safeParse(id).success) return new NextResponse(null, { status: 404 });

  const state = await loadContextState();
  if (state.status === "unauthenticated") return new NextResponse(null, { status: 401 });
  if (state.status !== "ok") return new NextResponse(null, { status: 403 });
  const { ctx } = state;
  const moduleKey = sales ? "sales" : purchase ? "purchases" : "payroll";
  const allowed = sales ? ctx.can(PDF_PERMISSION[sales]) : purchase ? ctx.can(PURCHASE_PDF_PERMISSION[purchase]) : ctx.can(PAYROLL_PDF_PERMISSION[payroll!]) || ctx.can("hr.payroll.manage");
  if (!ctx.hasModule(moduleKey) || !allowed) return new NextResponse(null, { status: 403 });

  try {
    const { data, filename } = sales ? await buildPdf(ctx, sales, id) : purchase ? await buildPurchasePdf(ctx, purchase, id) : await buildPayrollPdf(ctx, payroll!, id);
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
    if (e instanceof AppError && e.code === "NOT_FOUND") return new NextResponse(null, { status: 404 });
    console.error("[pdf]", e);
    return new NextResponse("Erreur de génération du document.", { status: 500 });
  }
}
