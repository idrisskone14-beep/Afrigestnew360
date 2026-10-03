import "server-only";
import { createHash } from "node:crypto";
import { detectImage } from "@/core/storage";

export const DOC_MAX_BYTES = 8 * 1024 * 1024;

export interface DetectedFile { mime: string; ext: string; inline: boolean }

const OOXML: Record<string, { mime: string; marker: string }> = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", marker: "word/" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", marker: "xl/" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", marker: "ppt/" },
};

const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

/**
 * Détermine le type RÉEL d'un fichier d'après ses octets (jamais d'après le nom ou le type déclaré par le navigateur).
 * Formats acceptés : PDF, images PNG/JPEG/WebP/GIF, Word/Excel/PowerPoint (OOXML), texte brut et CSV.
 * Tout le reste (exécutables, scripts, HTML, SVG, archives…) est refusé. Aucun antivirus n'est branché : voir la documentation.
 */
export function detectDocument(data: Buffer, fileName: string): DetectedFile | null {
  if (data.length >= 5 && data.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf", inline: true };
  const img = detectImage(data);
  if (img) return { mime: img.mime, ext: img.ext, inline: true };
  const head6 = data.subarray(0, 6).toString("latin1");
  if (head6 === "GIF87a" || head6 === "GIF89a") return { mime: "image/gif", ext: "gif", inline: true };

  const ext = extOf(fileName);
  // OOXML = archive ZIP dont les premières entrées nomment le contenu Office ; on ne décompresse jamais
  if (data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04 && OOXML[ext]) {
    const head = data.subarray(0, 8192).toString("latin1");
    if (head.includes("[Content_Types].xml") && head.includes(OOXML[ext]!.marker)) return { mime: OOXML[ext]!.mime, ext, inline: false };
    return null;
  }
  if ((ext === "txt" || ext === "csv" || ext === "md") && !data.subarray(0, 8192).includes(0)) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, Math.min(data.length, 65536))); } catch { return null; }
    return { mime: ext === "csv" ? "text/csv" : "text/plain", ext, inline: false };
  }
  return null;
}

/** Nom de fichier sûr : sans chemin, sans caractères de contrôle, longueur bornée, extension alignée sur le type détecté. */
export function safeFileName(original: string, ext: string): string {
  const base = original.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  const stem = (base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base).trim().slice(0, 100) || "document";
  return `${stem}.${ext}`;
}

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
