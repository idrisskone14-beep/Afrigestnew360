import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { assertSaneZip, decodeText, detectDelimiter, normHeader, parseBool, parseCsv, parseDateText, parseNumber, parseTable, IMPORT_MAX_ROWS } from "@/modules/data/parse";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("CSV", () => {
  it("guillemets, guillemets doublés, retours à la ligne dans un champ, CRLF et dernière ligne sans fin de ligne", () => {
    const csv = 'Nom;Note\r\n"Dupont; Fils";"Il dit ""bonjour""\nsur 2 lignes"\r\nSimple;ok';
    expect(parseCsv(csv)).toEqual([["Nom", "Note"], ["Dupont; Fils", 'Il dit "bonjour"\nsur 2 lignes'], ["Simple", "ok"]]);
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv('a;"";c')).toEqual([["a", "", "c"]]);
  });

  it("détecte le séparateur hors guillemets", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a,b";c;d')).toBe(";");
    expect(detectDelimiter("seule colonne")).toBe(";");
  });

  it("décode UTF-8 (avec BOM) puis Windows-1252 en repli", () => {
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf("Côte d'Ivoire")]))).toBe("Côte d'Ivoire");
    expect(decodeText(Buffer.from([0x43, 0xf4, 0x74, 0x65]))).toBe("Côte"); // « ô » en Windows-1252
  });
});

describe("valeurs", () => {
  it("nombres : formats français, anglais, espaces insécables, devises, pourcentages", () => {
    const cases: [string, number | null][] = [["1250", 1250], ["1 250,50", 1250.5], ["1.250,50", 1250.5], ["1,250.50", 1250.5], ["1250.5", 1250.5], ["1 250", 1250], ["12,5", 12.5], ["1.250.000", 1250000], ["1,250,000", 1250000], ["-300", -300], ["12 %", 12], ["5000 FCFA", 5000], ["abc", null], ["", null], ["12a", null], ["1,2,3x", null]];
    for (const [raw, expected] of cases) expect(parseNumber(raw), raw).toBe(expected);
  });

  it("dates : AAAA-MM-JJ et JJ/MM/AAAA ; dates impossibles refusées", () => {
    expect(parseDateText("2026-03-09")).toBe("2026-03-09");
    expect(parseDateText("09/03/2026")).toBe("2026-03-09");
    expect(parseDateText("9-3-2026")).toBe("2026-03-09");
    expect(parseDateText("09.03.2026")).toBe("2026-03-09");
    expect(parseDateText("31/02/2026")).toBeNull();
    expect(parseDateText("2026-13-01")).toBeNull();
    expect(parseDateText("demain")).toBeNull();
    expect(parseDateText("")).toBeNull();
  });

  it("booléens et en-têtes normalisés", () => {
    expect(["Oui", "x", "TRUE", "1"].map(parseBool)).toEqual([true, true, true, true]);
    expect(["Non", "false", "0"].map(parseBool)).toEqual([false, false, false]);
    expect(parseBool("peut-être")).toBeNull();
    expect(normHeader("  Délai de paiement (jours) ")).toBe("delaidepaiementjours");
  });
});

async function xlsx(rows: unknown[][], sheetCount = 1) {
  const wb = new ExcelJS.Workbook();
  for (let i = 0; i < sheetCount; i++) { const ws = wb.addWorksheet(`F${i}`); rows.forEach((r) => ws.addRow(r)); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("lecture d'un fichier d'import", () => {
  it("Excel : types convertis en texte, dates en ISO, formules lues par leur résultat, première feuille seulement", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Clients");
    ws.addRow(["Nom", "Date", "Montant", "Total"]);
    ws.addRow(["Alpha", new Date("2026-03-09T00:00:00Z"), 1250.5, { formula: "C2*2", result: 2501 }]);
    ws.addRow([]); // ligne vide ignorée
    ws.addRow(["Bêta", "10/03/2026", 5, { richText: [{ text: "ab" }, { text: "cd" }] }]);
    wb.addWorksheet("Autre").addRow(["ignorée"]);
    const t = await parseTable(Buffer.from(await wb.xlsx.writeBuffer()), "clients.xlsx");
    expect(t.format).toBe("xlsx");
    expect(t.headers).toEqual(["Nom", "Date", "Montant", "Total"]);
    expect(t.rows).toEqual([["Alpha", "2026-03-09", "1250.5", "2501"], ["Bêta", "10/03/2026", "5", "abcd"]]);
  });

  it("CSV : en-têtes, lignes vides, cellules manquantes complétées", async () => {
    const t = await parseTable(buf("Nom;Ville;Pays\nAlpha;Abidjan\n\n;;\nBêta;Dakar;SN\n"), "x.csv");
    expect(t.headers).toEqual(["Nom", "Ville", "Pays"]);
    expect(t.rows).toEqual([["Alpha", "Abidjan", ""], ["Bêta", "Dakar", "SN"]]);
  });

  it("refuse : vide, trop gros, ancien .xls, binaire renommé, zip non Excel, mauvaise extension, trop de lignes ou de colonnes", async () => {
    await expect(parseTable(Buffer.alloc(0), "a.csv")).rejects.toMatchObject({ message: expect.stringContaining("vide") });
    await expect(parseTable(Buffer.alloc(5 * 1024 * 1024 + 1, 65), "a.csv")).rejects.toMatchObject({ message: expect.stringContaining("Mo") });
    await expect(parseTable(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]), "ancien.xls")).rejects.toMatchObject({ message: expect.stringContaining(".xlsx") });
    await expect(parseTable(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100, 0)]), "virus.csv")).rejects.toMatchObject({ message: expect.stringContaining("texte") });
    await expect(parseTable(await xlsx([["a"], ["1"]]), "faux.csv")).rejects.toMatchObject({ message: expect.stringContaining("Format") }); // zip déguisé en csv
    await expect(parseTable(buf("a;b\n1;2"), "donnees.pdf")).rejects.toMatchObject({ message: expect.stringContaining("Format") });
    await expect(parseTable(buf("Nom;Ville\n"), "seul-entete.csv")).rejects.toMatchObject({ message: expect.stringContaining("au moins une ligne") });
    const many = "Nom\n" + Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `L${i}`).join("\n");
    await expect(parseTable(buf(many), "gros.csv")).rejects.toMatchObject({ message: expect.stringContaining("lignes") });
    await expect(parseTable(buf(Array.from({ length: 61 }, (_, i) => `c${i}`).join(";") + "\n" + Array.from({ length: 61 }, () => "x").join(";")), "large.csv")).rejects.toMatchObject({ message: expect.stringContaining("colonnes") });
    await expect(parseTable(await xlsx([Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => i)].concat(Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => [i]))), "gros.xlsx")).rejects.toBeTruthy();
  });

  it("bombe de décompression : un ZIP annonçant une taille énorme est refusé avant toute décompression", () => {
    // ZIP minimal : 1 entrée d'annuaire central annonçant 100 Mo décompressés
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(100 * 1024 * 1024, 24);
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(4, 16);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cd, eocd]);
    expect(() => assertSaneZip(zip)).toThrow(/volumineux/);
    expect(() => assertSaneZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(/illisible/);
  });
});
