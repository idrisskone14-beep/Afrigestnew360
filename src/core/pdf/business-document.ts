import "server-only";
import PDFDocument from "pdfkit";
import { formatMoney } from "@/lib/reference-data";

/** Les polices PDF standard (WinAnsi) n'ont pas l'espace fine insécable utilisée par Intl en français. */
export const pdfMoney = (amount: number, currency: string) => formatMoney(amount, currency).replace(/[  ]/g, " ");
const pdfNumber = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n).replace(/[  ]/g, " ");
const pdfDate = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(d) : "—");

export interface PdfParty { name: string; lines: string[] }

export interface PdfLine {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  total: number;
}

export interface BusinessDocument {
  title: string; // FACTURE, DEVIS…
  number: string;
  status?: { label: string; color: string };
  dates: { label: string; value: Date | null }[];
  currency: string;
  issuer: PdfParty & { legal: string[] };
  logo?: Buffer | null;
  recipient: PdfParty & { heading?: string };
  reference?: string;
  lines: PdfLine[];
  totals?: { label: string; value: number; bold?: boolean }[];
  /** Pour les documents sans prix (bon de livraison) : masque prix et totaux. */
  hidePrices?: boolean;
  notes?: string | null;
  terms?: string | null;
  footer?: string;
  extraBlocks?: { heading: string; rows: string[][] }[];
}

const INK = "#0F172A";
const MUTED = "#64748B";
const BRAND = "#2563EB";
const LINE = "#E2E8F0";

/** Rend un document commercial A4 (devis, facture, avoir, bon de livraison, reçu) et renvoie le PDF. */
export function renderBusinessDocument(doc: BusinessDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 40, info: { Title: `${doc.title} ${doc.number}`, Author: doc.issuer.name } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const left = 40;
    const right = pdf.page.width - 40;
    const width = right - left;

    // ── En-tête : logo + émetteur, titre du document
    let y = 40;
    let textX = left;
    if (doc.logo) {
      try {
        pdf.image(doc.logo, left, y, { fit: [70, 56] });
        textX = left + 82;
      } catch {
        /* format non supporté par pdfkit : on continue sans logo */
      }
    }
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(doc.issuer.name, textX, y, { width: 270 });
    pdf.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    for (const l of doc.issuer.lines) pdf.text(l, textX, pdf.y, { width: 270 });

    pdf.fillColor(BRAND).font("Helvetica-Bold").fontSize(20).text(doc.title, left + width / 2, y, { width: width / 2, align: "right" });
    pdf.fillColor(INK).fontSize(11).text(`N° ${doc.number}`, left + width / 2, pdf.y, { width: width / 2, align: "right" });
    if (doc.status) pdf.fillColor(doc.status.color).fontSize(9).text(doc.status.label.toUpperCase(), left + width / 2, pdf.y + 2, { width: width / 2, align: "right" });
    y = Math.max(pdf.y, y + 70) + 14;

    // ── Dates et destinataire
    pdf.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 12;
    const colW = width / 2 - 10;
    pdf.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text((doc.recipient.heading ?? "CLIENT").toUpperCase(), left, y);
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(doc.recipient.name, left, pdf.y + 2, { width: colW });
    pdf.font("Helvetica").fontSize(9).fillColor(INK);
    for (const l of doc.recipient.lines) pdf.text(l, left, pdf.y, { width: colW });
    const leftEnd = pdf.y;

    let dy = y;
    for (const d of doc.dates) {
      pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text(d.label, left + width / 2 + 20, dy, { width: 110 });
      pdf.fillColor(INK).font("Helvetica-Bold").text(pdfDate(d.value), left + width / 2 + 130, dy, { width: width / 2 - 130, align: "right" });
      dy += 15;
    }
    if (doc.reference) {
      pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text("Référence", left + width / 2 + 20, dy, { width: 110 });
      pdf.fillColor(INK).font("Helvetica-Bold").text(doc.reference, left + width / 2 + 130, dy, { width: width / 2 - 130, align: "right" });
      dy += 15;
    }
    y = Math.max(leftEnd, dy) + 18;

    // ── Tableau des lignes
    const cols = doc.hidePrices
      ? [{ k: "description", x: left, w: width - 130, a: "left" as const, h: "Désignation" }, { k: "qty", x: right - 130, w: 130, a: "right" as const, h: "Quantité" }]
      : [
          { k: "description", x: left, w: 205, a: "left" as const, h: "Désignation" },
          { k: "qty", x: left + 205, w: 55, a: "right" as const, h: "Qté" },
          { k: "price", x: left + 262, w: 70, a: "right" as const, h: "P.U. HT" },
          { k: "disc", x: left + 334, w: 40, a: "right" as const, h: "Rem." },
          { k: "tax", x: left + 376, w: 40, a: "right" as const, h: "TVA" },
          { k: "total", x: left + 418, w: width - 418, a: "right" as const, h: "Total TTC" },
        ];
    const header = () => {
      pdf.rect(left, y, width, 20).fill(INK);
      pdf.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);
      for (const c of cols) pdf.text(c.h, c.x + 4, y + 6, { width: c.w - 8, align: c.a });
      y += 24;
    };
    header();
    pdf.font("Helvetica").fontSize(9);
    doc.lines.forEach((l, i) => {
      const desc = l.description;
      const h = Math.max(pdf.heightOfString(desc, { width: cols[0]!.w - 8 }), 12) + 8;
      if (y + h > pdf.page.height - 150) { pdf.addPage(); y = 40; header(); }
      if (i % 2 === 1) pdf.rect(left, y - 2, width, h).fill("#F8FAFC");
      pdf.fillColor(INK).font("Helvetica").fontSize(9);
      const cells: Record<string, string> = {
        description: desc, qty: `${pdfNumber(l.quantity)} ${l.unit}`.trim(), price: pdfMoney(l.unitPrice, doc.currency), disc: l.discountPct ? `${pdfNumber(l.discountPct)} %` : "—",
        tax: l.taxRate ? `${pdfNumber(l.taxRate)} %` : "—", total: pdfMoney(l.total, doc.currency),
      };
      for (const c of cols) pdf.text(cells[c.k]!, c.x + 4, y + 2, { width: c.w - 8, align: c.a });
      y += h;
      pdf.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor(LINE).lineWidth(0.5).stroke();
    });

    // ── Totaux
    if (!doc.hidePrices && doc.totals?.length) {
      y += 10;
      if (y + doc.totals.length * 18 > pdf.page.height - 120) { pdf.addPage(); y = 40; }
      const bx = left + width - 230;
      for (const t of doc.totals) {
        if (t.bold) pdf.rect(bx, y - 3, 230, 22).fill("#EFF6FF");
        pdf.fillColor(t.bold ? BRAND : MUTED).font(t.bold ? "Helvetica-Bold" : "Helvetica").fontSize(t.bold ? 11 : 9.5).text(t.label, bx + 8, y + (t.bold ? 2 : 0), { width: 110 });
        pdf.fillColor(INK).font(t.bold ? "Helvetica-Bold" : "Helvetica").text(pdfMoney(t.value, doc.currency), bx + 110, y + (t.bold ? 2 : 0), { width: 112, align: "right" });
        y += t.bold ? 26 : 18;
      }
    }

    // ── Blocs complémentaires (échéancier, paiements…)
    for (const b of doc.extraBlocks ?? []) {
      if (!b.rows.length) continue;
      y += 14;
      if (y + 30 + b.rows.length * 14 > pdf.page.height - 100) { pdf.addPage(); y = 40; }
      pdf.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(b.heading, left, y);
      y = pdf.y + 4;
      pdf.font("Helvetica").fontSize(8.5).fillColor(MUTED);
      for (const r of b.rows) {
        r.forEach((cell, i) => pdf.text(cell, left + i * (width / r.length), y, { width: width / r.length - 6, align: i === r.length - 1 ? "right" : "left" }));
        y += 13;
      }
    }

    // ── Notes et conditions
    for (const [h, txt] of [["Notes", doc.notes], ["Conditions", doc.terms]] as const) {
      if (!txt) continue;
      y += 14;
      pdf.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text(h.toUpperCase(), left, y);
      pdf.fillColor(INK).font("Helvetica").fontSize(9).text(txt, left, pdf.y + 2, { width });
      y = pdf.y;
    }

    // ── Pied de page : mentions légales
    const fy = pdf.page.height - 60;
    pdf.moveTo(left, fy - 6).lineTo(right, fy - 6).strokeColor(LINE).lineWidth(0.5).stroke();
    pdf.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(doc.issuer.legal.filter(Boolean).join("  ·  "), left, fy, { width, align: "center" });
    if (doc.footer) pdf.text(doc.footer, left, pdf.y + 2, { width, align: "center" });
    pdf.end();
  });
}
