import "server-only";
import PDFDocument from "pdfkit";
import { pdfMoney } from "@/core/pdf/business-document";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { issuer } from "@/modules/sales/pdf";
import { getPayslip, periodLabel } from "./service";

export const PAYROLL_PDF_PERMISSION = { payslip: "hr.payslip.read" } as const;
export type PayrollPdfKind = keyof typeof PAYROLL_PDF_PERMISSION;

const INK = "#0F172A", MUTED = "#64748B", BRAND = "#2563EB", LINE = "#E2E8F0";
const PAYOUT: Record<string, string> = { BANK_TRANSFER: "Virement", CASH: "Espèces", MOBILE_MONEY: "Mobile money" };
const pdfDate = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(d) : "—");
const pct = (n: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(n)} %`.replace(/[  ]/g, " ");
const pdfNum = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n).replace(/[  ]/g, " ");

/**
 * Bulletin de paie PDF. L'accès (la paie, ou le salarié concerné pour un bulletin validé) est contrôlé par `getPayslip` :
 * tout autre cas répond « introuvable ».
 */
export async function buildPayrollPdf(ctx: TenantContext, kind: PayrollPdfKind, id: string): Promise<{ data: Buffer; filename: string }> {
  void kind;
  const s = await getPayslip(ctx, id);
  const base = await issuer(ctx);
  const cur = s.run.currency;
  const data = await new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 40, info: { Title: `Bulletin de paie ${s.number ?? "(brouillon)"}`, Author: base.issuer.name } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const left = 40, right = pdf.page.width - 40, width = right - left;

    // En-tête
    let y = 40, textX = left;
    if (base.logo) { try { pdf.image(base.logo, left, y, { fit: [70, 56] }); textX = left + 82; } catch { /* logo non supporté */ } }
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(base.issuer.name, textX, y, { width: 270 });
    pdf.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    for (const l of [...base.issuer.lines, ...base.issuer.legal]) pdf.text(l, textX, pdf.y, { width: 270 });
    pdf.fillColor(BRAND).font("Helvetica-Bold").fontSize(20).text("BULLETIN DE PAIE", left + width / 2, y, { width: width / 2, align: "right" });
    pdf.fillColor(INK).fontSize(11).text(s.number ? `N° ${s.number}` : "BROUILLON", left + width / 2, pdf.y, { width: width / 2, align: "right" });
    pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text(`Période : ${periodLabel(s.run.year, s.run.month)}`, left + width / 2, pdf.y + 2, { width: width / 2, align: "right" });
    y = Math.max(pdf.y, y + 70) + 12;
    pdf.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 12;

    // Salarié
    pdf.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("SALARIÉ", left, y);
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(`${s.employee.firstName} ${s.employee.lastName}`, left, pdf.y + 2, { width: width / 2 });
    pdf.font("Helvetica").fontSize(9);
    pdf.text(`Matricule : ${s.employee.number}`, left, pdf.y, { width: width / 2 });
    if (s.employee.jobTitle) pdf.text(`Poste : ${s.employee.jobTitle}`, left, pdf.y, { width: width / 2 });
    pdf.text(`Embauché le ${pdfDate(s.employee.hireDate)}`, left, pdf.y, { width: width / 2 });
    const lefty = pdf.y;
    let ry = y;
    const kv = (k: string, v: string) => { pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text(k, left + width / 2 + 20, ry, { width: 130 }); pdf.fillColor(INK).font("Helvetica-Bold").text(v, left + width / 2 + 150, ry, { width: width / 2 - 150, align: "right" }); ry += 15; };
    kv("Salaire de base mensuel", pdfMoney(num(s.baseSalary), cur));
    kv("Temps payé", `${pdfNum(num(s.prorata) * 100)} %`);
    if (num(s.unpaidDays) > 0) kv("Jours non payés", pdfNum(num(s.unpaidDays)));
    kv("Mode de paiement", PAYOUT[s.payoutMethod ?? ""] ?? "—");
    y = Math.max(lefty, ry) + 14;

    // Tableau des rubriques
    const cols = { label: left, base: left + 215, rate: left + 290, gain: left + 345, ded: left + 430 };
    const header = () => {
      pdf.rect(left, y, width, 20).fill("#F1F5F9");
      pdf.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
      pdf.text("RUBRIQUE", cols.label + 6, y + 6, { width: 200 });
      pdf.text("BASE", cols.base, y + 6, { width: 70, align: "right" });
      pdf.text("TAUX", cols.rate, y + 6, { width: 50, align: "right" });
      pdf.text("GAINS", cols.gain, y + 6, { width: 80, align: "right" });
      pdf.text("RETENUES", cols.ded, y + 6, { width: right - cols.ded - 6, align: "right" });
      y += 24;
    };
    header();
    const payLines = s.lines.filter((l) => l.type !== "EMPLOYER");
    for (const l of payLines) {
      if (y > pdf.page.height - 160) { pdf.addPage(); y = 40; header(); }
      pdf.fillColor(INK).font("Helvetica").fontSize(9);
      pdf.text(l.label, cols.label + 6, y, { width: 205 });
      const rowEnd = pdf.y;
      if (l.base) pdf.text(pdfNum(num(l.base)), cols.base, y, { width: 70, align: "right" });
      if (l.rate) pdf.text(pct(num(l.rate)), cols.rate, y, { width: 50, align: "right" });
      if (l.type === "EARNING") pdf.text(pdfNum(num(l.amount)), cols.gain, y, { width: 80, align: "right" });
      else pdf.text(pdfNum(num(l.amount)), cols.ded, y, { width: right - cols.ded - 6, align: "right" });
      y = rowEnd + 5;
      pdf.moveTo(left, y - 2).lineTo(right, y - 2).strokeColor(LINE).lineWidth(0.5).stroke();
    }

    // Totaux
    y += 8;
    const box = (label: string, value: string, bold = false) => {
      pdf.fillColor(bold ? INK : MUTED).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).text(label, left + width / 2, y, { width: width / 2 - 130 });
      pdf.fillColor(INK).font(bold ? "Helvetica-Bold" : "Helvetica").text(value, right - 130, y, { width: 130, align: "right" });
      y += bold ? 20 : 16;
    };
    box("Salaire brut", pdfMoney(num(s.gross), cur));
    box("Total des retenues", pdfMoney(num(s.totalDeductions), cur));
    pdf.moveTo(left + width / 2, y).lineTo(right, y).strokeColor(INK).lineWidth(1).stroke();
    y += 6;
    box("NET À PAYER", pdfMoney(num(s.netPay), cur), true);

    // Charges patronales (information)
    const employer = s.lines.filter((l) => l.type === "EMPLOYER");
    if (employer.length) {
      y += 10;
      pdf.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("CHARGES PATRONALES (information — non retenues sur le net)", left, y);
      y = pdf.y + 4;
      for (const l of employer) {
        pdf.fillColor(INK).font("Helvetica").fontSize(9).text(l.label, left + 6, y, { width: 300 });
        pdf.text(pdfMoney(num(l.amount), cur), right - 130, y, { width: 130, align: "right" });
        y = pdf.y + 3;
      }
      pdf.fillColor(INK).font("Helvetica-Bold").fontSize(9).text("Coût total employeur", left + 6, y, { width: 300 });
      pdf.text(pdfMoney(num(s.employerCost), cur), right - 130, y, { width: 130, align: "right" });
    }
    pdf.fillColor(MUTED).font("Helvetica").fontSize(7.5).text("Document généré par AfriGest 360. À conserver sans limitation de durée.", left, pdf.page.height - 50, { width: width, align: "center" });
    pdf.end();
  });
  return { data, filename: `bulletin-${s.number ?? s.id.slice(0, 8)}.pdf` };
}
