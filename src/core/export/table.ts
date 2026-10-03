import "server-only";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/**
 * Tableau exportable : un SEUL modèle de données alimente l'écran, le CSV, l'Excel, le PDF et l'impression,
 * pour que les chiffres exportés soient exactement ceux affichés.
 */
export type ColType = "text" | "number" | "money" | "date" | "percent";
export interface ExportColumn { key: string; label: string; type?: ColType; width?: number }
export type Cell = string | number | boolean | Date | null | undefined;
export interface ExportTable {
  title: string;
  subtitle?: string;
  company: string;
  currency: string;
  generatedAt: Date;
  /** Filtres appliqués, imprimés en tête des exports. */
  filters?: [string, string][];
  columns: ExportColumn[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
}

const iso = (v: Cell) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));
const frDate = (v: Cell) => (v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(typeof v === "string" ? v.slice(0, 10) : v)) : String(v ?? ""));
const num = (n: number, max = 2) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: max }).format(n).replace(/[  ]/g, " ");

/** Texte affiché (PDF, impression) d'une cellule selon le type de sa colonne. */
export function displayCell(v: Cell, c: ExportColumn, currency: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (c.type === "money") return `${num(v, currency === "XOF" || currency === "XAF" ? 0 : 2)} ${currency === "XOF" ? "FCFA" : currency === "XAF" ? "FCFA" : currency}`;
    if (c.type === "percent") return `${num(v, 1)} %`;
    return num(v, 3);
  }
  if (c.type === "date") return frDate(v);
  return typeof v === "boolean" ? (v ? "Oui" : "Non") : v instanceof Date ? iso(v) : String(v);
}

// ── CSV ───────────────────────────────────────────────────────

/** Neutralise l'injection de formules (=, +, -, @, tabulation, retour chariot) dans les cellules TEXTE. */
export const csvSafe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const csvField = (s: string) => (/[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV pour Excel francophone : séparateur « ; », BOM UTF-8, décimale « , », dates ISO. */
export function toCsv(t: ExportTable): Buffer {
  const cell = (v: Cell) => (typeof v === "number" ? String(v).replace(".", ",") : csvSafe(iso(typeof v === "boolean" ? (v ? "Oui" : "Non") : v)));
  const lines = [t.columns.map((c) => csvField(csvSafe(c.label))).join(";")];
  for (const r of t.rows) lines.push(t.columns.map((c) => csvField(cell(r[c.key]))).join(";"));
  if (t.totals) lines.push(t.columns.map((c, i) => csvField(i === 0 && t.totals![c.key] === undefined ? "Total" : cell(t.totals![c.key]))).join(";"));
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}

// ── Excel ─────────────────────────────────────────────────────

const XLSX_FORMAT: Partial<Record<ColType, string>> = { money: "#,##0.00", number: "#,##0.###", percent: '0.0"%"', date: "dd/mm/yyyy" };

export async function toXlsx(t: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AfriGest 360";
  wb.created = t.generatedAt;
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ state: "frozen", ySplit: 3 + (t.filters?.length ?? 0) }] });
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  ws.addRow([`${t.company} — généré le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(t.generatedAt)}${t.subtitle ? ` — ${t.subtitle}` : ""}`]).font = { color: { argb: "FF64748B" } };
  for (const [k, v] of t.filters ?? []) ws.addRow([`${k} : ${v}`]).font = { color: { argb: "FF64748B" }, italic: true };
  const head = ws.addRow(t.columns.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } }; });
  const put = (r: Record<string, Cell>, bold = false) => {
    const row = ws.addRow(t.columns.map((c) => {
      const v = r[c.key];
      if (c.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(`${v.slice(0, 10)}T00:00:00Z`);
      return v === undefined ? null : v;
    }));
    t.columns.forEach((c, i) => { const f = XLSX_FORMAT[c.type ?? "text"]; if (f) row.getCell(i + 1).numFmt = f; });
    if (bold) row.font = { bold: true };
  };
  for (const r of t.rows) put(r);
  if (t.totals) put({ [t.columns[0]!.key]: "Total", ...t.totals }, true);
  t.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? Math.min(48, Math.max(12, c.label.length + 4)); });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ───────────────────────────────────────────────────────

const INK = "#0F172A", MUTED = "#64748B", HEAD = "#1E3A8A", LINE = "#E2E8F0", ZEBRA = "#F8FAFC";

/** PDF A4 paysage : en-tête (entreprise, filtres), tableau à en-tête répété, ligne de total, pagination. */
export function toPdf(t: ExportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: t.title, Author: "AfriGest 360" } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const left = 36, width = pdf.page.width - 72, bottom = pdf.page.height - 48;
    const weights = t.columns.map((c) => c.width ?? (c.type === "text" || !c.type ? 18 : 12));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * width);
    const clean = (s: string) => s.replace(/[  ]/g, " ");

    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(t.title, left, 36);
    pdf.font("Helvetica").fontSize(9).fillColor(MUTED).text(clean(`${t.company} — généré le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(t.generatedAt)}${t.subtitle ? ` — ${t.subtitle}` : ""}`));
    for (const [k, v] of t.filters ?? []) pdf.text(clean(`${k} : ${v}`));
    pdf.moveDown(0.6);

    let y = pdf.y;
    const header = () => {
      pdf.rect(left, y, width, 18).fill(HEAD);
      let x = left;
      t.columns.forEach((c, i) => { pdf.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8).text(clean(c.label), x + 4, y + 5, { width: widths[i]! - 8, align: c.type && c.type !== "text" && c.type !== "date" ? "right" : "left", lineBreak: false, ellipsis: true }); x += widths[i]!; });
      y += 18;
    };
    const line = (r: Record<string, Cell>, zebra: boolean, bold: boolean) => {
      const texts = t.columns.map((c, i) => clean(displayCell(i === 0 && bold && r[c.key] === undefined ? "Total" : r[c.key], c, t.currency)));
      pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const h = Math.max(...texts.map((s, i) => pdf.heightOfString(s, { width: widths[i]! - 8 })), 9) + 7;
      if (y + h > bottom) { pdf.addPage(); y = 36; header(); }
      if (zebra) pdf.rect(left, y, width, h).fill(ZEBRA);
      let x = left;
      texts.forEach((s, i) => { const c = t.columns[i]!; pdf.fillColor(INK).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).text(s, x + 4, y + 4, { width: widths[i]! - 8, align: c.type && c.type !== "text" && c.type !== "date" ? "right" : "left" }); x += widths[i]!; });
      pdf.moveTo(left, y + h).lineTo(left + width, y + h).strokeColor(LINE).lineWidth(0.5).stroke();
      y += h;
    };
    header();
    if (t.rows.length === 0) { pdf.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("Aucune donnée pour ces filtres.", left + 4, y + 8); y += 24; }
    t.rows.forEach((r, i) => line(r, i % 2 === 1, false));
    if (t.totals) line(t.totals, false, true);

    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      pdf.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Page ${i + 1} / ${range.count} — AfriGest 360`, left, pdf.page.height - 30, { width, align: "right", lineBreak: false });
    }
    pdf.end();
  });
}

export type ExportFormat = "csv" | "xlsx" | "pdf";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "xlsx", "pdf"];
export const EXPORT_MIME: Record<ExportFormat, string> = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" };

export async function renderExport(t: ExportTable, format: ExportFormat): Promise<Buffer> {
  return format === "csv" ? toCsv(t) : format === "xlsx" ? toXlsx(t) : toPdf(t);
}

/** Nom de fichier d'export sûr et daté. */
export const exportFileName = (title: string, format: ExportFormat, at = new Date()) =>
  `${title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export"}-${at.toISOString().slice(0, 10)}.${format}`;
