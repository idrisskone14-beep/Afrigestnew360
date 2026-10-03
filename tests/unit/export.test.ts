import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { csvSafe, displayCell, exportFileName, toCsv, toPdf, toXlsx, type ExportTable } from "@/core/export/table";

const table = (over: Partial<ExportTable> = {}): ExportTable => ({
  title: "Rapport d'essai", company: "ACME SARL", currency: "XOF", generatedAt: new Date("2026-10-03T08:00:00Z"),
  filters: [["Période", "octobre 2026"]],
  columns: [{ key: "name", label: "Client" }, { key: "date", label: "Date", type: "date" }, { key: "amount", label: "Montant", type: "money" }, { key: "rate", label: "Taux", type: "percent" }],
  rows: [{ name: "Quincaillerie Koffi", date: "2026-10-01", amount: 1250.5, rate: 12.5 }, { name: "=HYPERLINK(\"http://evil\")", date: new Date("2026-10-02T00:00:00Z"), amount: -300, rate: null }],
  totals: { amount: 950.5 },
  ...over,
});

describe("export CSV", () => {
  it("neutralise l'injection de formules dans les textes mais pas dans les nombres", () => {
    expect(csvSafe("=1+1")).toBe("'=1+1");
    expect(csvSafe("+33 1")).toBe("'+33 1");
    expect(csvSafe("-cmd")).toBe("'-cmd");
    expect(csvSafe("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvSafe("normal")).toBe("normal");
    const out = toCsv(table()).toString("utf8");
    expect(out.charCodeAt(0)).toBe(0xfeff); // BOM pour Excel
    expect(out).toContain("'=HYPERLINK(");
    expect(out).toContain(";-300;"); // un montant négatif reste un nombre
  });

  it("échappe séparateurs, guillemets et retours à la ligne ; décimales à la française ; ligne de total", () => {
    const out = toCsv(table({ rows: [{ name: 'Dupont; "Fils"\nSARL', date: "2026-10-01", amount: 1250.5, rate: 1 }] })).toString("utf8").split("\r\n");
    expect(out[0]).toBe("﻿Client;Date;Montant;Taux");
    expect(out[1]).toBe('"Dupont; ""Fils""\nSARL";2026-10-01;1250,5;1');
    expect(out[2]).toBe("Total;;950,5;");
  });
});

describe("export Excel", () => {
  it("produit un classeur lisible, avec types numériques et dates conservés", async () => {
    const buf = await toXlsx(table());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.worksheets[0]!;
    const rows = ws.getSheetValues().filter(Boolean) as unknown[][];
    const header = rows.find((r) => r.includes("Montant"))!;
    expect(header).toBeTruthy();
    const data = ws.getRow(5); // titre, sous-titre, 1 filtre, en-tête → 1re ligne de données
    expect(data.getCell(1).value).toBe("Quincaillerie Koffi");
    expect(data.getCell(3).value).toBe(1250.5);
    expect(data.getCell(2).value).toBeInstanceOf(Date);
    // une cellule texte débutant par « = » n'est jamais interprétée comme formule
    expect(typeof ws.getRow(6).getCell(1).value).toBe("string");
    expect(ws.getRow(7).getCell(1).value).toBe("Total");
  });
});

describe("export PDF", () => {
  it("génère un PDF valide et pagine les longs tableaux", async () => {
    const short = await toPdf(table());
    expect(short.subarray(0, 5).toString()).toBe("%PDF-");
    const rows = Array.from({ length: 120 }, (_, i) => ({ name: `Client ${i}`, date: "2026-10-01", amount: i * 1000, rate: i }));
    const long = await toPdf(table({ rows }));
    expect(long.length).toBeGreaterThan(short.length);
    expect((long.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(2);
    await expect(toPdf(table({ rows: [], totals: undefined }))).resolves.toBeInstanceOf(Buffer);
  });
});

describe("formats d'affichage", () => {
  it("monnaie FCFA sans décimale, pourcentage, date française", () => {
    const [name, date, amount, rate] = table().columns;
    expect(displayCell(1250.5, amount!, "XOF")).toBe("1 251 FCFA");
    expect(displayCell(12.5, rate!, "XOF")).toBe("12,5 %");
    expect(displayCell("2026-10-01", date!, "XOF")).toContain("2026");
    expect(displayCell(null, name!, "XOF")).toBe("");
  });

  it("nom de fichier sûr et daté", () => {
    expect(exportFileName("Créances clients / été", "xlsx", new Date("2026-10-03T00:00:00Z"))).toBe("Creances-clients-ete-2026-10-03.xlsx");
    expect(exportFileName("../../etc/passwd", "csv", new Date("2026-10-03T00:00:00Z"))).toBe("etc-passwd-2026-10-03.csv");
  });
});
