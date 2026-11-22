import "server-only";
import ExcelJS from "exceljs";
import type { FneDocKind } from "@/generated/prisma/client";
import { audit } from "@/core/audit";
import { businessRule } from "@/core/errors";
import { d, num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/ctx-factory";

/**
 * Registre FNE : suivi du chiffre d'affaires à partir de l'export des factures de l'espace FNE de la DGI (fichier Excel).
 * L'API de la DGI ne permet que d'envoyer (certifier) des documents : on ne peut pas les relire. L'export du portail est donc la
 * seule source. Le registre ne crée ni facture, ni écriture comptable, ni créance : il ne fait que suivre ce qui a été certifié.
 *
 * Règles de lecture (vérifiées sur un export réel) :
 *  - « Sous-type de facture » : normal → facture, refund → avoir (montants déjà négatifs), proforma → jamais compté dans le CA ;
 *  - « Type de facture » autre que « invoice » (bordereau d'achat…) : ignoré, ce n'est pas du chiffre d'affaires ;
 *  - la clé de dédoublonnage est la « Référence » FNE (le « Token » est parfois partagé entre un avoir et des proformas) ;
 *  - ré-importer un export plus récent n'ajoute que les documents nouveaux.
 */

export const FNE_REGISTRY_MAX_ROWS = 20_000;

export interface FneRegistryRow {
  reference: string;
  kind: FneDocKind;
  initialReference: string | null;
  token: string | null;
  issuedAt: Date;
  paymentMethod: string | null;
  template: string | null;
  taxRegime: string | null;
  totalHt: string;
  discount: string;
  totalVat: string;
  totalTtc: string;
  otherTaxes: string;
  netToPay: string;
  currency: string;
  customerName: string;
  customerNcc: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  seller: string | null;
  establishment: string | null;
  pointOfSale: string | null;
}

export interface FneParseResult {
  rows: FneRegistryRow[];
  /** lignes lues, hors en-tête */
  total: number;
  /** même numéro FNE présent plusieurs fois dans le fichier (la première est gardée) */
  duplicatesInFile: number;
  /** lignes qui ne sont pas du chiffre d'affaires (bordereaux d'achat, types inconnus) */
  skipped: number;
  /** documents exportés sans numéro FNE propre (avoir dont seule la facture d'origine est connue) : comptés, à vérifier dans l'espace FNE */
  withoutNumber: number;
  /** lignes illisibles, avec le motif (les 5 premières) */
  invalid: { line: number; reason: string }[];
  invalidCount: number;
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

const COLUMNS = {
  reference: "reference",
  initialReference: "reference initial",
  token: "token",
  type: "type de facture",
  subType: "sous-type de facture",
  date: "date",
  paymentMethod: "mode de paiement",
  totalHt: "total ht",
  discount: "remise",
  totalVat: "total tva",
  totalTtc: "total ttc",
  otherTaxes: "total autres taxes",
  netToPay: "net a payer",
  customerNcc: "ncc du client",
  customerName: "nom de la societe / du client",
  customerPhone: "telephone du client",
  customerEmail: "email du client",
  seller: "nom du vendeur",
  establishment: "etablissement",
  pointOfSale: "point de vente",
  taxRegime: "regime d'imposition",
  template: "type de facturation",
  currency: "devises etrangeres",
} as const;
const REQUIRED: (keyof typeof COLUMNS)[] = ["reference", "subType", "date", "totalHt", "totalVat", "totalTtc"];
const LABELS: Record<string, string> = {
  reference: "Référence", subType: "Sous-type de facture", date: "Date", totalHt: "Total HT", totalVat: "Total TVA", totalTtc: "Total TTC",
};

const cellValue = (v: ExcelJS.CellValue): unknown => {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return v.result;
    if ("text" in v) return (v as { text: unknown }).text;
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  }
  return v;
};
const text = (v: unknown, max = 200): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s.slice(0, max) : null;
};
const amount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Lit l'export Excel de l'espace FNE. Ne touche à aucune base : testable avec un fichier fabriqué. */
export async function parseFneExport(data: Buffer): Promise<FneParseResult> {
  // un fichier .xlsx est une archive ZIP : on le vérifie sur les octets, pas sur l'extension
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) throw businessRule("Ce fichier n'est pas un classeur Excel (.xlsx). Importez l'export téléchargé depuis l'espace FNE, sans l'avoir converti.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw businessRule("Impossible de lire ce fichier Excel. Téléchargez à nouveau l'export depuis l'espace FNE.");
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw businessRule("Le fichier ne contient aucune facture.");
  if (ws.rowCount - 1 > FNE_REGISTRY_MAX_ROWS) throw businessRule(`Le fichier dépasse ${FNE_REGISTRY_MAX_ROWS.toLocaleString("fr-FR")} lignes : exportez une période plus courte.`);

  const headers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => { headers.set(norm(cellValue(cell.value)), col); });
  const missing = REQUIRED.filter((k) => !headers.has(COLUMNS[k]));
  if (missing.length) throw businessRule(`Ce fichier ne ressemble pas à un export de factures FNE : colonne${missing.length > 1 ? "s" : ""} manquante${missing.length > 1 ? "s" : ""} (${missing.map((k) => LABELS[k]).join(", ")}).`);
  const col = (r: ExcelJS.Row, k: keyof typeof COLUMNS) => { const c = headers.get(COLUMNS[k]); return c ? cellValue(r.getCell(c).value) : undefined; };

  const rows: FneRegistryRow[] = [];
  const seen = new Set<string>();
  const out: FneParseResult = { rows, total: 0, duplicatesInFile: 0, skipped: 0, withoutNumber: 0, invalid: [], invalidCount: 0 };
  const bad = (line: number, reason: string) => { out.invalidCount++; if (out.invalid.length < 5) out.invalid.push({ line, reason }); };

  for (let n = 2; n <= ws.rowCount; n++) {
    const r = ws.getRow(n);
    let reference = text(col(r, "reference"), 80);
    const initialReference = text(col(r, "initialReference"), 80);
    if (!reference && !text(col(r, "totalTtc"))) continue; // ligne vide
    out.total++;
    if (!reference && !initialReference) { bad(n, "numéro FNE (Référence) absent"); continue; }

    const type = norm(col(r, "type"));
    const sub = norm(col(r, "subType"));
    if (type && type !== "invoice") { out.skipped++; continue; } // bordereau d'achat…
    if (!reference && sub !== "refund" && sub !== "normal") { bad(n, "numéro FNE (Référence) absent"); continue; }
    const kind: FneDocKind | null = sub === "normal" ? "INVOICE" : sub === "refund" ? "REFUND" : sub === "proforma" ? "PROFORMA" : null;
    if (!kind) { out.skipped++; continue; }

    const rawDate = col(r, "date");
    const issuedAt = rawDate instanceof Date ? rawDate : new Date(String(rawDate ?? ""));
    if (Number.isNaN(issuedAt.getTime())) { bad(n, `date illisible (${reference})`); continue; }
    const ht = amount(col(r, "totalHt")), vat = amount(col(r, "totalVat")), ttc = amount(col(r, "totalTtc"));
    if (ht === null || vat === null || ttc === null) { bad(n, `montant illisible (${reference ?? `facture ${initialReference}`})`); continue; }
    if (!reference) {
      // Il arrive que l'espace FNE exporte un avoir sans numéro propre (seule la facture d'origine est indiquée). Le rejeter fausserait le
      // chiffre d'affaires : on le garde, sous une clé stable (facture d'origine + date exacte) pour ne pas le doubler à la ré-importation.
      reference = `SANS-NUMERO-${initialReference}-${issuedAt.getTime()}`;
      out.withoutNumber++;
    }
    if (seen.has(reference)) { out.duplicatesInFile++; continue; }
    seen.add(reference);

    // un avoir diminue le chiffre d'affaires : l'export le donne déjà en négatif, on le garantit
    const fix = (v: number) => (kind === "REFUND" ? -Math.abs(v) : v);
    const net = amount(col(r, "netToPay"));
    const discount = amount(col(r, "discount")) ?? 0;
    const other = amount(col(r, "otherTaxes")) ?? 0;
    const cur = text(col(r, "currency"), 8);
    rows.push({
      reference,
      kind,
      initialReference,
      token: text(col(r, "token"), 80),
      issuedAt,
      paymentMethod: text(col(r, "paymentMethod"), 40),
      template: text(col(r, "template"), 10),
      taxRegime: text(col(r, "taxRegime"), 20),
      totalHt: d(fix(ht)).toFixed(2),
      discount: d(kind === "REFUND" ? -Math.abs(discount) : discount).toFixed(2),
      totalVat: d(fix(vat)).toFixed(2),
      totalTtc: d(fix(ttc)).toFixed(2),
      otherTaxes: d(kind === "REFUND" ? -Math.abs(other) : other).toFixed(2),
      netToPay: d(fix(net ?? ttc)).toFixed(2),
      currency: cur && /^[A-Za-z]{3}$/.test(cur) ? cur.toUpperCase() : "XOF",
      customerName: text(col(r, "customerName"), 200) ?? "Client non renseigné",
      customerNcc: text(col(r, "customerNcc"), 40),
      customerPhone: text(col(r, "customerPhone"), 40),
      customerEmail: text(col(r, "customerEmail"), 150),
      seller: text(col(r, "seller"), 120),
      establishment: text(col(r, "establishment"), 150),
      pointOfSale: text(col(r, "pointOfSale"), 150),
    });
  }
  return out;
}

export interface FneImportResult {
  /** lignes lues dans le fichier */
  total: number;
  added: { invoices: number; refunds: number; proformas: number };
  /** déjà présentes dans le registre (même numéro FNE) : ignorées */
  alreadyKnown: number;
  duplicatesInFile: number;
  skipped: number;
  withoutNumber: number;
  invalidCount: number;
  invalid: { line: number; reason: string }[];
}

/** Ajoute au registre les documents nouveaux de l'export ; ceux dont le numéro FNE est déjà connu sont ignorés. */
export async function importFneRegistry(ctx: Pick<TenantContext, "db" | "company" | "user">, file: { name: string }, data: Buffer): Promise<FneImportResult> {
  const parsed = await parseFneExport(data);
  const companyId = ctx.company.id;

  const known = new Set<string>();
  if (parsed.rows.length) {
    const found = await ctx.db.fneRegistryEntry.findMany({ where: { reference: { in: parsed.rows.map((r) => r.reference) } }, select: { reference: true } });
    for (const f of found) known.add(f.reference);
  }
  const fresh = parsed.rows.filter((r) => !known.has(r.reference));
  const added = { invoices: 0, refunds: 0, proformas: 0 };
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 500) {
    const batch = fresh.slice(i, i + 500);
    // skipDuplicates : deux imports simultanés ne peuvent pas créer de doublon (clé unique société + numéro FNE)
    const res = await ctx.db.fneRegistryEntry.createMany({ data: batch.map((r) => ({ ...r, companyId })), skipDuplicates: true });
    inserted += res.count;
  }
  for (const r of fresh) added[r.kind === "INVOICE" ? "invoices" : r.kind === "REFUND" ? "refunds" : "proformas"]++;

  const result: FneImportResult = {
    total: parsed.total,
    added,
    alreadyKnown: known.size + (fresh.length - inserted),
    duplicatesInFile: parsed.duplicatesInFile,
    skipped: parsed.skipped,
    withoutNumber: parsed.withoutNumber,
    invalidCount: parsed.invalidCount,
    invalid: parsed.invalid,
  };
  await audit(ctx as TenantContext, {
    action: "fne.registry.import", resource: "FneRegistryEntry", resourceId: companyId,
    summary: `${ctx.user.name} a importé l'export FNE « ${file.name.replace(/^.*[\\/]/, "").slice(0, 120)} » : ${inserted} document${inserted > 1 ? "s" : ""} ajouté${inserted > 1 ? "s" : ""}, ${result.alreadyKnown} déjà connu${result.alreadyKnown > 1 ? "s" : ""}.`,
    after: { ...result, invalid: undefined },
  });
  return result;
}

// ── Suivi du chiffre d'affaires ──────────────────────────────────────────────

export interface FneRevenueSummary {
  currency: string;
  /** chiffre d'affaires net = factures + avoirs (négatifs), proformas exclus */
  ht: number;
  vat: number;
  ttc: number;
  invoices: number;
  refunds: number;
  refundsTtc: number;
  proformas: number;
  proformasTtc: number;
  months: { month: string; ht: number; vat: number; ttc: number; invoices: number; refunds: number }[];
  customers: { key: string; name: string; ncc: string | null; ht: number; ttc: number; documents: number }[];
  methods: { method: string; ttc: number; documents: number }[];
  first: Date | null;
  last: Date | null;
}

type Entry = { kind: FneDocKind; issuedAt: Date; totalHt: unknown; totalVat: unknown; totalTtc: unknown; customerName: string; customerNcc: string | null; paymentMethod: string | null; currency: string };

/** Agrège des lignes du registre. Fonction pure : la période est choisie par l'appelant. */
export function summarizeFneRegistry(entries: Entry[], currency = "XOF"): FneRevenueSummary {
  const s: FneRevenueSummary = { currency, ht: 0, vat: 0, ttc: 0, invoices: 0, refunds: 0, refundsTtc: 0, proformas: 0, proformasTtc: 0, months: [], customers: [], methods: [], first: null, last: null };
  const months = new Map<string, FneRevenueSummary["months"][number]>();
  const customers = new Map<string, FneRevenueSummary["customers"][number]>();
  const methods = new Map<string, { method: string; ttc: number; documents: number }>();
  for (const e of entries) {
    if (!s.first || e.issuedAt < s.first) s.first = e.issuedAt;
    if (!s.last || e.issuedAt > s.last) s.last = e.issuedAt;
    const ht = num(e.totalHt as never), vat = num(e.totalVat as never), ttc = num(e.totalTtc as never);
    if (e.kind === "PROFORMA") { s.proformas++; s.proformasTtc += ttc; continue; } // une proforma n'est pas du chiffre d'affaires
    s.ht += ht; s.vat += vat; s.ttc += ttc;
    if (e.kind === "INVOICE") s.invoices++; else { s.refunds++; s.refundsTtc += ttc; }

    const mk = e.issuedAt.toISOString().slice(0, 7);
    const m = months.get(mk) ?? { month: mk, ht: 0, vat: 0, ttc: 0, invoices: 0, refunds: 0 };
    m.ht += ht; m.vat += vat; m.ttc += ttc; if (e.kind === "INVOICE") m.invoices++; else m.refunds++;
    months.set(mk, m);

    const ck = e.customerNcc || e.customerName.toUpperCase();
    const c = customers.get(ck) ?? { key: ck, name: e.customerName, ncc: e.customerNcc, ht: 0, ttc: 0, documents: 0 };
    c.ht += ht; c.ttc += ttc; c.documents++;
    customers.set(ck, c);

    const pm = e.paymentMethod ?? "non précisé";
    const p = methods.get(pm) ?? { method: pm, ttc: 0, documents: 0 };
    p.ttc += ttc; p.documents++;
    methods.set(pm, p);
  }
  s.months = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  s.customers = [...customers.values()].sort((a, b) => b.ht - a.ht);
  s.methods = [...methods.values()].sort((a, b) => b.ttc - a.ttc);
  return s;
}

/** Chiffre d'affaires certifié d'une période (bornes [gte, lt[). */
export async function loadFneRevenue(ctx: Pick<TenantContext, "db" | "company">, period: { gte?: Date; lt?: Date }): Promise<FneRevenueSummary> {
  const rows = await ctx.db.fneRegistryEntry.findMany({
    where: { issuedAt: { ...(period.gte ? { gte: period.gte } : {}), ...(period.lt ? { lt: period.lt } : {}) } },
    select: { kind: true, issuedAt: true, totalHt: true, totalVat: true, totalTtc: true, customerName: true, customerNcc: true, paymentMethod: true, currency: true },
  });
  return summarizeFneRegistry(rows, ctx.company.currency);
}
