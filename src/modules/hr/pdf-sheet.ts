import "server-only";
import PDFDocument from "pdfkit";
import { drawPdfFooters } from "@/core/pdf/business-document";
import { DOCUMENT_BRAND } from "@/core/pdf/legal-footer";
import type { TenantContext } from "@/core/tenant/context";
import { issuer } from "@/modules/sales/pdf";

const INK = "#0F172A", MUTED = "#64748B", BRAND = "#007A58", LINE = "#E2E8F0";

export interface Sheet {
  title: string;
  number: string;
  subtitle?: string;
  sections: { heading: string; rows: [string, string | null | undefined][] }[];
  signatures: string[];
  note?: string;
  footer: string;
}

/** Fiche A4 générique (en-tête de l'entreprise, sections libellé/valeur, zone de signatures, pied de page légal) pour les registres RH. */
export async function renderSheet(ctx: TenantContext, s: Sheet): Promise<Buffer> {
  const base = await issuer(ctx);
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `${s.title} ${s.number}`, Author: base.issuer.name } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const left = 40, right = pdf.page.width - 40, width = right - left;
    let y = 40, textX = left;
    if (base.logo) { try { pdf.image(base.logo, left, y, { fit: [70, 56] }); textX = left + 82; } catch { /* logo non supporté */ } }
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(base.issuer.name, textX, y, { width: 270 });
    pdf.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    for (const l of [...base.issuer.lines, ...base.issuer.legal]) pdf.text(l, textX, pdf.y, { width: 270 });
    pdf.fillColor(BRAND).font("Helvetica-Bold").fontSize(15).text(s.title.toUpperCase(), left + width / 2, y, { width: width / 2, align: "right" });
    pdf.fillColor(INK).fontSize(11).text(`N° ${s.number}`, left + width / 2, pdf.y, { width: width / 2, align: "right" });
    if (s.subtitle) pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text(s.subtitle, left + width / 2, pdf.y + 2, { width: width / 2, align: "right" });
    y = Math.max(pdf.y, y + 70) + 10;
    pdf.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    pdf.y = y + 12;
    const bottom = () => pdf.page.height - 90;
    for (const sec of s.sections) {
      if (pdf.y > bottom() - 40) pdf.addPage();
      pdf.moveDown(0.6);
      pdf.fillColor(BRAND).font("Helvetica-Bold").fontSize(9).text(sec.heading.toUpperCase(), left, pdf.y, { width });
      pdf.moveDown(0.2);
      for (const [k, v] of sec.rows) {
        if (pdf.y > bottom()) pdf.addPage();
        const top = pdf.y;
        pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text(k, left, top, { width: 150 });
        const afterKey = pdf.y;
        pdf.fillColor(INK).font("Helvetica").fontSize(9.5).text(v && v.trim() ? v : "—", left + 155, top, { width: width - 155 });
        pdf.y = Math.max(afterKey, pdf.y) + 3;
      }
    }
    if (pdf.y > bottom() - 80) pdf.addPage();
    const sy = pdf.y + 24, w = width / Math.max(1, s.signatures.length);
    pdf.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    s.signatures.forEach((label, i) => pdf.text(label, left + i * w, sy, { width: w - 8 }));
    if (s.note) pdf.fillColor(MUTED).fontSize(7.5).text(s.note, left, sy + 60, { width });
    drawPdfFooters(pdf, { text: base.issuer.footer, left, width, brand: `${DOCUMENT_BRAND}. ${s.footer}` });
    pdf.end();
  });
}
