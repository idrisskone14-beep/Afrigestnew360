import "server-only";
import PDFDocument from "pdfkit";
import { formatMoney } from "@/lib/reference-data";
import { DOCUMENT_BRAND } from "./legal-footer";

type PdfDoc = InstanceType<typeof PDFDocument>;

/** Les polices PDF standard (WinAnsi) n'ont pas l'espace fine insécable utilisée par Intl en français. */
const WIDE_SPACES = /[  ]/g; // espace fine insécable (milliers) et espace insécable (avant « F CFA »)
export const pdfMoney = (amount: number, currency: string) => formatMoney(amount, currency).replace(WIDE_SPACES, " ");
const pdfNumber = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n).replace(WIDE_SPACES, " ");
const pdfDate = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(d) : "—");

export interface PdfParty { name: string; lines: string[] }

export interface PdfLine {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  /** Total TTC de la ligne. */
  total: number;
  /** Montant HT après remise et montant de taxe (valeurs enregistrées) : servent au tableau « Total HT » et au détail de TVA. */
  net?: number;
  tax?: number;
}

export interface BusinessDocument {
  title: string; // Devis, Facture…
  number: string;
  status?: { label: string; color: string };
  dates: { label: string; value: Date | null }[];
  currency: string;
  /** `legal` : mentions d'identité (en-tête du bulletin de paie) ; `footer` : ligne de mentions légales imprimée en pied de chaque page. */
  issuer: PdfParty & { legal: string[]; footer: string };
  logo?: Buffer | null;
  recipient: PdfParty & { heading?: string };
  reference?: string;
  lines: PdfLine[];
  totals?: { label: string; value: number; bold?: boolean }[];
  /** Pour les documents sans prix (bon de livraison) : masque prix et totaux. */
  hidePrices?: boolean;
  notes?: string | null;
  terms?: string | null;
  extraBlocks?: { heading: string; rows: string[][] }[];
  /** Cadre de signature (« Bon pour accord » sur un devis). */
  signatureLabel?: string;
}

const INK = "#0B1F44";
const MUTED = "#51607A";
const ORANGE = "#EA580C";
const LINE = "#DFE6F1";

/** « FACTURE PROFORMA » → « Facture proforma » : le titre s'affiche en minuscules, comme sur les devis de référence. */
export const sentenceCase = (s: string) => {
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Détail de TVA : base HT et montant de taxe par taux (valeurs enregistrées par ligne, repli sur le calcul). */
export function taxBreakdown(lines: PdfLine[]): { rate: number; base: number; tax: number }[] {
  const byRate = new Map<number, { base: number; tax: number }>();
  for (const l of lines) {
    const net = l.net ?? l.quantity * l.unitPrice * (1 - l.discountPct / 100);
    const tax = l.tax ?? (net * l.taxRate) / 100;
    const cur = byRate.get(l.taxRate) ?? { base: 0, tax: 0 };
    byRate.set(l.taxRate, { base: cur.base + net, tax: cur.tax + tax });
  }
  return [...byRate].map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate);
}

const FOOTER_BOTTOM = 28; // distance entre le pied de page et le bas de la feuille

/** Hauteur du pied de page (mentions légales + ligne de marque) : le contenu s'arrête au-dessus. */
export function pdfFooterHeight(pdf: PdfDoc, text: string, width: number): number {
  pdf.font("Helvetica").fontSize(7.5);
  return pdf.heightOfString(text.replace(WIDE_SPACES, " "), { width }) + 3 + 9;
}

/**
 * Imprime le pied de page sur CHAQUE page : filet, mentions légales de l'émetteur, puis « Document généré par AfriGest 360 »
 * (et « Page n / N » dès qu'il y a plusieurs pages). Le document doit avoir été créé avec `bufferPages: true`.
 */
export function drawPdfFooters(pdf: PdfDoc, o: { text: string; left: number; width: number; brand?: string }) {
  const text = o.text.replace(WIDE_SPACES, " ");
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    const h = pdfFooterHeight(pdf, text, o.width);
    const top = pdf.page.height - FOOTER_BOTTOM - h;
    // marge basse à 0 le temps de l'écriture : sinon pdfkit ajoute une page dès que le texte dépasse la marge
    const margin = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf.moveTo(o.left, top - 6).lineTo(o.left + o.width, top - 6).strokeColor(LINE).lineWidth(0.5).stroke();
    pdf.fillColor(INK).font("Helvetica").fontSize(7.5).text(text, o.left, top, { width: o.width });
    const by = top + h - 9;
    pdf.fillColor(MUTED).font("Helvetica").fontSize(7).text(o.brand ?? DOCUMENT_BRAND, o.left, by, { width: o.width, lineBreak: false });
    if (range.count > 1) pdf.text(`Page ${i + 1} / ${range.count}`, o.left, by, { width: o.width, align: "right", lineBreak: false });
    pdf.page.margins.bottom = margin;
  }
}

/** Rend un document commercial A4 (devis, facture, avoir, bon de livraison, reçu) et renvoie le PDF. */
export function renderBusinessDocument(doc: BusinessDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `${doc.title} ${doc.number}`, Author: doc.issuer.name } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const left = 40;
    const right = pdf.page.width - 40;
    const width = right - left;
    // le contenu s'arrête au-dessus du pied de page (dont la hauteur dépend de la longueur des mentions légales)
    const footerLimit = pdf.page.height - FOOTER_BOTTOM - pdfFooterHeight(pdf, doc.issuer.footer, width) - 14;
    const bottomLimit = () => footerLimit;

    // ── En-tête : logo à gauche, titre et numéro à droite
    let y = 40;
    if (doc.logo) {
      try {
        pdf.image(doc.logo, left, y, { fit: [170, 72] });
      } catch {
        /* format non supporté par pdfkit : on continue sans logo */
      }
    }
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(28).text(sentenceCase(doc.title), left + width / 2, y, { width: width / 2, align: "right", lineBreak: false });
    pdf.fillColor(MUTED).font("Helvetica").fontSize(10).text(`N° ${doc.number}`, left + width / 2, y + 36, { width: width / 2, align: "right" });
    if (doc.status) pdf.fillColor(doc.status.color).font("Helvetica-Bold").fontSize(9).text(doc.status.label.toUpperCase(), left + width / 2, pdf.y + 3, { width: width / 2, align: "right" });
    y = Math.max(pdf.y, y + 76) + 26;

    // ── Émetteur (gauche) et destinataire (droite)
    const colW = width / 2 - 14;
    const rx = left + width / 2 + 14;
    pdf.fillColor(ORANGE).font("Helvetica").fontSize(9).text("Émetteur", left, y);
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(doc.issuer.name.toUpperCase(), left, pdf.y + 3, { width: colW });
    pdf.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const l of doc.issuer.lines) pdf.text(l, left, pdf.y + 1, { width: colW });
    const leftEnd = pdf.y;

    pdf.fillColor(ORANGE).font("Helvetica").fontSize(9).text(doc.recipient.heading ?? "Client", rx, y);
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(doc.recipient.name, rx, pdf.y + 3, { width: colW });
    pdf.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const l of doc.recipient.lines) pdf.text(l, rx, pdf.y + 1, { width: colW });
    y = Math.max(leftEnd, pdf.y) + 22;

    // ── Dates (et référence), alignées à droite
    const meta = [...doc.dates.map((d) => ({ label: d.label, value: pdfDate(d.value) })), ...(doc.reference ? [{ label: "Référence", value: doc.reference }] : [])];
    if (meta.length) {
      const mw = Math.min(130, width / meta.length);
      meta.forEach((m, i) => {
        const x = right - mw * (meta.length - i);
        pdf.fillColor(ORANGE).font("Helvetica").fontSize(8.5).text(m.label, x, y, { width: mw - 8, align: "right" });
        pdf.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(m.value, x, y + 13, { width: mw - 8, align: "right" });
      });
      y += 44;
    }

    // ── Tableau des lignes (en-tête orange)
    const cols = doc.hidePrices
      ? [{ k: "description", x: left, w: width - 130, a: "left" as const, h: "Désignations" }, { k: "qty", x: right - 130, w: 130, a: "right" as const, h: "Quantité" }]
      : [
          { k: "description", x: left, w: 215, a: "left" as const, h: "Désignations" },
          { k: "qty", x: left + 215, w: 50, a: "right" as const, h: "Qté" },
          { k: "price", x: left + 265, w: 90, a: "right" as const, h: "Prix u. HT" },
          { k: "tax", x: left + 355, w: 60, a: "right" as const, h: "TVA (%)" },
          { k: "total", x: left + 415, w: width - 415, a: "right" as const, h: "Total HT" },
        ];
    const header = () => {
      pdf.rect(left, y, width, 24).fill(ORANGE);
      pdf.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);
      for (const c of cols) pdf.text(c.h, c.x + 6, y + 8, { width: c.w - 12, align: c.a });
      y += 28;
    };
    header();
    pdf.font("Helvetica").fontSize(9);
    doc.lines.forEach((l) => {
      const desc = l.discountPct && !doc.hidePrices ? `${l.description}\nRemise ${pdfNumber(l.discountPct)} %` : l.description;
      const h = Math.max(pdf.heightOfString(desc, { width: cols[0]!.w - 12 }), 12) + 10;
      if (y + h > bottomLimit() - 160) { pdf.addPage(); y = 40; header(); }
      pdf.fillColor(INK).font("Helvetica").fontSize(9);
      const net = l.net ?? l.quantity * l.unitPrice * (1 - l.discountPct / 100);
      const cells: Record<string, string> = {
        description: desc, qty: `${pdfNumber(l.quantity)} ${l.unit}`.trim(), price: pdfMoney(l.unitPrice, doc.currency),
        tax: `${pdfNumber(l.taxRate)}%`, total: pdfMoney(net, doc.currency),
      };
      for (const c of cols) pdf.text(cells[c.k]!, c.x + 6, y + 3, { width: c.w - 12, align: c.a });
      y += h;
      pdf.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor(LINE).lineWidth(0.5).stroke();
    });

    // ── Détail de TVA (gauche) et récapitulatif (droite)
    if (!doc.hidePrices && doc.totals?.length) {
      y += 18;
      const recapW = 240;
      const recapX = right - recapW;
      const breakdown = taxBreakdown(doc.lines);
      const rows = doc.totals.map((t) => (t.label === "TVA" ? { ...t, label: "Total TVA" } : t));
      const need = Math.max(28 + breakdown.length * 22, 28 + rows.length * 24) + 10;
      if (y + need > bottomLimit()) { pdf.addPage(); y = 40; }
      const top = y;

      // détail par taux
      const vw = [95, 55, 100];
      let vx = left;
      pdf.rect(left, top, vw[0]! + vw[1]! + vw[2]!, 24).fill(ORANGE);
      pdf.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);
      ["Base", "Taux", "Montant TVA"].forEach((h, i) => { pdf.text(h, vx + 6, top + 8, { width: vw[i]! - 12, align: i === 0 ? "left" : "right" }); vx += vw[i]!; });
      let vy = top + 28;
      for (const b of breakdown) {
        vx = left;
        pdf.fillColor(INK).font("Helvetica").fontSize(9);
        [pdfMoney(b.base, doc.currency), `${pdfNumber(b.rate)}%`, pdfMoney(b.tax, doc.currency)].forEach((v, i) => { pdf.text(v, vx + 6, vy + 2, { width: vw[i]! - 12, align: i === 0 ? "left" : "right" }); vx += vw[i]!; });
        vy += 22;
        pdf.moveTo(left, vy - 4).lineTo(left + vw[0]! + vw[1]! + vw[2]!, vy - 4).strokeColor(LINE).lineWidth(0.5).stroke();
      }

      // récapitulatif
      pdf.rect(recapX, top, recapW, 24).fill(ORANGE);
      pdf.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5).text("Récapitulatif", recapX + 8, top + 8, { width: recapW - 16 });
      let ry = top + 28;
      for (const t of rows) {
        pdf.fillColor(INK).font(t.bold ? "Helvetica-Bold" : "Helvetica").fontSize(t.bold ? 10.5 : 9.5);
        pdf.text(t.label, recapX + 8, ry + 2, { width: 120 });
        pdf.text(pdfMoney(t.value, doc.currency), recapX + 120, ry + 2, { width: recapW - 128, align: "right" });
        ry += 24;
        pdf.moveTo(recapX, ry - 4).lineTo(right, ry - 4).strokeColor(LINE).lineWidth(0.5).stroke();
      }
      y = Math.max(vy, ry) + 6;
    }

    // ── Blocs complémentaires (échéancier, paiements…)
    for (const b of doc.extraBlocks ?? []) {
      if (!b.rows.length) continue;
      y += 14;
      if (y + 30 + b.rows.length * 14 > bottomLimit()) { pdf.addPage(); y = 40; }
      pdf.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(b.heading, left, y);
      y = pdf.y + 4;
      pdf.font("Helvetica").fontSize(8.5).fillColor(MUTED);
      for (const r of b.rows) {
        r.forEach((cell, i) => pdf.text(cell, left + i * (width / r.length), y, { width: width / r.length - 6, align: i === r.length - 1 ? "right" : "left" }));
        y += 13;
      }
    }

    // ── Notes et conditions (paiement et mentions)
    for (const [h, txt] of [["Notes", doc.notes], ["Paiement et mentions", doc.terms]] as const) {
      if (!txt) continue;
      y += 14;
      if (y + 40 > bottomLimit()) { pdf.addPage(); y = 40; }
      pdf.fillColor(ORANGE).font("Helvetica").fontSize(9).text(h, left, y);
      pdf.fillColor(INK).font("Helvetica").fontSize(9).text(txt, left, pdf.y + 2, { width });
      y = pdf.y;
    }

    // ── Cadre de signature
    if (doc.signatureLabel) {
      y += 18;
      if (y + 80 > bottomLimit()) { pdf.addPage(); y = 40; }
      const bw = 250;
      pdf.rect(right - bw, y, bw, 70).strokeColor(LINE).lineWidth(1).stroke();
      pdf.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(doc.signatureLabel, right - bw + 8, y + 8, { width: bw - 16 });
    }

    // ── Pied de page : mentions légales sur chaque page
    drawPdfFooters(pdf, { text: doc.issuer.footer, left, width });
    pdf.end();
  });
}
