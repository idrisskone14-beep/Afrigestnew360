import ExcelJS from "exceljs";
import { uid } from "./helpers";

const HEADERS = ["Référence initial", "Token", "Référence", "Type de facture", "Sous-type de facture", "Date", "Mode de paiement", "Timbre de quittance", "Total HT", "Remise", "Total TVA", "Total TTC", "Total Autres taxes", "Net a payer", "NCC du client", "Nom de la société / du client", "Téléphone du client", "Email du client", "Terminal", "RCCM", "Nom du vendeur", "Établissement", "Point de vente", "Régime d’imposition", "Type de facturation", "Autres Mentions", "Pied de page", "Devises étrangères", "Taux de change", "Est RNE", "RNE", "Créé à", "Mise à jour à"];

export interface Doc { ref: string; sub?: string; type?: string; date?: string; ht?: unknown; vat?: unknown; ttc?: unknown; initial?: string; token?: string; client?: string; ncc?: string; pay?: string }

/** Fabrique un export au format de l'espace FNE (mêmes en-têtes, mêmes types de valeurs). */
export async function exportOf(docs: Doc[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet");
  ws.addRow(HEADERS);
  for (const d of docs) {
    const row: unknown[] = new Array(HEADERS.length).fill(null);
    const set = (h: string, v: unknown) => { row[HEADERS.indexOf(h)] = v; };
    set("Référence initial", d.initial ?? null); set("Token", d.token ?? uid()); set("Référence", d.ref);
    set("Type de facture", d.type ?? "invoice"); set("Sous-type de facture", d.sub ?? "normal");
    set("Date", d.date ?? "2026-03-10T10:00:00.000Z"); set("Mode de paiement", d.pay ?? "check");
    set("Total HT", d.ht ?? 1000); set("Total TVA", d.vat ?? 180); set("Total TTC", d.ttc ?? 1180); set("Net a payer", d.ttc ?? 1180);
    set("Remise", 0); set("Total Autres taxes", 0);
    set("NCC du client", d.ncc ?? "1205106C"); set("Nom de la société / du client", d.client ?? "CLIENT TEST");
    set("Régime d’imposition", "RNI"); set("Type de facturation", "B2B"); set("Devises étrangères", "XOF");
    ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
