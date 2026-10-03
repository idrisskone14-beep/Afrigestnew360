import "server-only";
import { NextResponse } from "next/server";
import { EXPORT_FORMATS, EXPORT_MIME, exportFileName, renderExport, type ExportFormat, type ExportTable } from "./table";

export const parseFormat = (v: string | null): ExportFormat | null => EXPORT_FORMATS.find((f) => f === v) ?? null;

/** Réponse de téléchargement d'un export : jamais mise en cache, type forcé, nom de fichier assaini. */
export async function exportResponse(table: ExportTable, format: ExportFormat) {
  const data = await renderExport(table, format);
  const name = exportFileName(table.title, format, table.generatedAt);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": EXPORT_MIME[format],
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
