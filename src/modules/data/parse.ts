import "server-only";
import ExcelJS from "exceljs";
import { AppError } from "@/core/errors";

/** Limites d'un fichier d'import (protègent la mémoire et la durée de traitement). */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_COLS = 60;
const MAX_UNCOMPRESSED = 60 * 1024 * 1024;

const bad = (message: string) => new AppError("VALIDATION", message);

// ── Texte / CSV ───────────────────────────────────────────────

/** Décode un fichier texte : UTF-8 (BOM toléré), sinon Windows-1252 (exports Excel francophones anciens). */
export function decodeText(data: Buffer): string {
  const body = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { return new TextDecoder("windows-1252").decode(body); }
}

/** Séparateur le plus probable (« ; », « , » ou tabulation) d'après la première ligne hors guillemets. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  let inQuotes = false;
  const count: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  for (const ch of first) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in count) count[ch]!++;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]![1] > 0 ? Object.entries(count).sort((a, b) => b[1] - a[1])[0]![0] : ";";
}

/** CSV (RFC 4180) : guillemets, guillemets doublés, retours à la ligne dans les champs, CRLF/LF. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
    if (rows.length > IMPORT_MAX_ROWS + 2) throw bad(`Le fichier dépasse ${IMPORT_MAX_ROWS} lignes : découpez-le en plusieurs imports.`);
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ── Excel ─────────────────────────────────────────────────────

/**
 * Contrôle d'un classeur .xlsx AVANT décompression : on lit l'annuaire central du ZIP et on refuse les archives
 * dont la taille décompressée ou le nombre d'entrées sont déraisonnables (bombe de décompression).
 */
export function assertSaneZip(data: Buffer) {
  const tail = Math.max(0, data.length - 65557);
  const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < tail || eocd < 0 || eocd + 22 > data.length) throw bad("Classeur Excel illisible ou corrompu.");
  const entries = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  if (entries > 500) throw bad("Classeur Excel trop complexe.");
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) throw bad("Classeur Excel illisible ou corrompu.");
    total += data.readUInt32LE(offset + 24);
    if (total > MAX_UNCOMPRESSED) throw bad("Classeur Excel trop volumineux une fois décompressé.");
    offset += 46 + data.readUInt16LE(offset + 28) + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formule : on garde la valeur calculée
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return "";
    return "";
  }
  return String(v);
};

export async function parseXlsx(data: Buffer): Promise<string[][]> {
  assertSaneZip(data);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(data as never); } catch { throw bad("Classeur Excel illisible ou corrompu."); }
  const ws = wb.worksheets[0];
  if (!ws) throw bad("Le classeur ne contient aucune feuille.");
  const rows: string[][] = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length > IMPORT_MAX_ROWS + 1) return;
    const cells = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    width = Math.max(width, cells.length);
    rows.push(cells);
  });
  if (rows.length > IMPORT_MAX_ROWS + 1) throw bad(`Le fichier dépasse ${IMPORT_MAX_ROWS} lignes : découpez-le en plusieurs imports.`);
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

// ── Point d'entrée ────────────────────────────────────────────

export interface ParsedTable { headers: string[]; rows: string[][]; format: "csv" | "xlsx" }

/**
 * Lit un fichier d'import. Le format est déterminé sur les OCTETS (signature ZIP + extension pour Excel, texte UTF-8/ANSI pour CSV) :
 * le nom ou le type MIME déclaré par le navigateur ne suffisent jamais. Le .xls (ancien binaire) est refusé explicitement.
 */
export async function parseTable(data: Buffer, fileName: string): Promise<ParsedTable> {
  if (data.length === 0) throw bad("Le fichier est vide.");
  if (data.length > IMPORT_MAX_BYTES) throw bad(`Le fichier dépasse ${IMPORT_MAX_BYTES / 1024 / 1024} Mo.`);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const isZip = data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  const isOle = data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  let raw: string[][];
  let format: ParsedTable["format"];
  if (isOle) throw bad("Ancien format Excel (.xls) non pris en charge : enregistrez le fichier au format .xlsx ou CSV.");
  if (isZip) {
    if (ext !== "xlsx") throw bad("Format non reconnu : utilisez un fichier .xlsx ou .csv.");
    raw = await parseXlsx(data); format = "xlsx";
  } else {
    if (ext !== "csv" && ext !== "txt") throw bad("Format non reconnu : utilisez un fichier .xlsx ou .csv.");
    if (data.subarray(0, 8192).includes(0)) throw bad("Ce fichier n'est pas un fichier texte CSV valide.");
    raw = parseCsv(decodeText(data)); format = "csv";
  }
  // lignes entièrement vides ignorées (fréquentes en fin de fichier)
  const nonEmpty = raw.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length < 2) throw bad("Le fichier doit contenir une ligne d'en-têtes et au moins une ligne de données.");
  const headers = nonEmpty[0]!.map((h) => h.trim());
  if (headers.length > IMPORT_MAX_COLS) throw bad(`Trop de colonnes (${IMPORT_MAX_COLS} maximum).`);
  if (headers.every((h) => h === "")) throw bad("La première ligne doit contenir les noms des colonnes.");
  const rows = nonEmpty.slice(1).map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  if (rows.length > IMPORT_MAX_ROWS) throw bad(`Le fichier dépasse ${IMPORT_MAX_ROWS} lignes : découpez-le en plusieurs imports.`);
  return { headers, rows, format };
}

// ── Normalisation des valeurs ─────────────────────────────────

/** Nom de colonne comparable : minuscules, sans accents, espaces ni ponctuation. */
export const normHeader = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** « 1 250,50 », « 1.250,50 », « 1,250.50 », « 1250.5 », « 12 % » → nombre ; null si illisible. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[\s  ]/g, "").replace(/%$/, "").replace(/(fcfa|xof|xaf|f)$/i, "");
  if (s === "") return null;
  if (!/^[+-]?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lastComma >= 0) s = /^[+-]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** AAAA-MM-JJ, JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA → AAAA-MM-JJ ; null si invalide (dates impossibles refusées). */
export function parseDateText(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt: RegExpMatchArray | null;
  if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) { y = +mt[1]!; m = +mt[2]!; d = +mt[3]!; }
  else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { d = +mt[1]!; m = +mt[2]!; y = +mt[3]!; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseBool(raw: string): boolean | null {
  const s = normHeader(raw);
  if (["oui", "o", "yes", "y", "true", "vrai", "1", "x"].includes(s)) return true;
  if (["non", "n", "no", "false", "faux", "0"].includes(s)) return false;
  return null;
}
